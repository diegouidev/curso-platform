"""Apply a ScanResult to the database, idempotently.

Rules:
- Everything is matched by Drive id (folder id for modules, file id for lessons/attachments).
- Titles the user edited (`title_is_custom`) are never overwritten.
- Lessons are never deleted: when a file disappears it is flagged `missing_in_drive`, so
  progress and notes survive. It is un-flagged if the file comes back.
- Order follows natural sort of Drive names unless the user reordered that level, in which
  case existing items keep their order and new ones are appended.
- Attachments carry no user data and are simply removed when they disappear.
"""

from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from .models import Attachment, Course, Lesson, Module
from .naming import make_title, natural_key, path_key, stem_key
from .scanner import ScannedFile, ScannedModule, ScanResult

GENERAL_MODULE_TITLE = "Geral"
PATH_SEPARATOR = " / "


@dataclass
class SyncStats:
    modules_created: int = 0
    modules_missing: int = 0
    lessons_created: int = 0
    lessons_updated: int = 0
    lessons_missing: int = 0
    lessons_restored: int = 0
    attachments: int = 0
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def _is_native_doc(mime_type: str) -> bool:
    return mime_type.startswith("application/vnd.google-apps.")


def _repeats(title: str, folder: str) -> bool:
    """`title` starts with the whole `folder` name ("01 - Welcome - Parte 1" / "01 - Welcome")."""
    t, f = title.casefold(), folder.casefold()
    return t.startswith(f) and (len(t) == len(f) or not t[len(f)].isalnum())


def drive_file_title(name: str, mime_type: str, path: list[str], *, clean: bool) -> str:
    """Title derived from the Drive: nested folders prefix it ("Parte 1 / Aula 3")."""
    title = make_title(name, is_file=not _is_native_doc(mime_type), clean=clean)
    if not path:
        return title
    folders = [make_title(part, is_file=False, clean=clean) for part in path]
    if clean and _repeats(title, folders[-1]):
        # "01 - Welcome / 01 - Welcome - Parte 1" reads better as "01 - Welcome - Parte 1".
        folders.pop()
    return PATH_SEPARATOR.join([*folders, title])


def drive_module_title(name: str, *, is_root: bool, clean: bool) -> str:
    if is_root:
        return GENERAL_MODULE_TITLE
    return make_title(name, is_file=False, clean=clean)


def _file_title(file: ScannedFile, clean: bool) -> str:
    return drive_file_title(file.name, file.mime_type, file.path, clean=clean)


def _module_title(module: ScannedModule, clean: bool) -> str:
    return drive_module_title(module.name, is_root=module.is_root, clean=clean)


def _sort_files(files: list[ScannedFile]) -> list[ScannedFile]:
    return sorted(files, key=lambda f: path_key([*f.path, f.name]))


class _Syncer:
    def __init__(self, course: Course, scan: ScanResult) -> None:
        self.course = course
        self.scan = scan
        self.clean = course.clean_titles
        self.stats = SyncStats()
        self.modules = {m.drive_folder_id: m for m in course.modules.all()}
        self.lessons = {
            lesson.drive_file_id: lesson
            for lesson in Lesson.objects.filter(module__course=course).select_related("module")
        }
        self.attachments = {
            a.drive_file_id: a
            for a in Attachment.objects.filter(
                Q(module__course=course) | Q(lesson__module__course=course)
            )
        }
        self.seen_modules: set[str] = set()
        self.seen_lessons: set[str] = set()
        self.seen_attachments: set[str] = set()

    def run(self) -> SyncStats:
        self._sync_course()
        scanned = sorted(self.scan.modules, key=lambda m: (not m.is_root, natural_key(m.name)))
        next_order = self._next_module_order()
        for index, scanned_module in enumerate(scanned):
            if not scanned_module.files:
                continue
            module, next_order = self._sync_module(scanned_module, index, next_order)
            lessons_by_stem = self._sync_lessons(module, scanned_module)
            self._sync_attachments(module, scanned_module, lessons_by_stem)
        self._flag_missing()
        return self.stats

    # --- course / modules -------------------------------------------------------------
    def _sync_course(self) -> None:
        course = self.course
        course.drive_name_original = self.scan.root_name
        if not course.title_is_custom:
            course.title = make_title(self.scan.root_name, is_file=False, clean=self.clean)
        course.last_imported_at = timezone.now()
        course.save(update_fields=["drive_name_original", "title", "last_imported_at"])

    def _next_module_order(self) -> int:
        current = self.course.modules.aggregate(m=Max("order"))["m"]
        return 0 if current is None else current + 1

    def _sync_module(
        self, scanned: ScannedModule, index: int, next_order: int
    ) -> tuple[Module, int]:
        self.seen_modules.add(scanned.folder_id)
        title = _module_title(scanned, self.clean)
        module = self.modules.get(scanned.folder_id)

        if module is None:
            if self.course.modules_order_is_custom:
                order, next_order = next_order, next_order + 1
            else:
                order = index
            module = Module.objects.create(
                course=self.course,
                title=title,
                drive_folder_id=scanned.folder_id,
                drive_name_original=scanned.name,
                order=order,
            )
            self.modules[scanned.folder_id] = module
            self.stats.modules_created += 1
            return module, next_order

        module.drive_name_original = scanned.name
        module.missing_in_drive = False
        if not module.title_is_custom:
            module.title = title
        if not self.course.modules_order_is_custom:
            module.order = index
        module.save(update_fields=["drive_name_original", "missing_in_drive", "title", "order"])
        return module, next_order

    # --- lessons ------------------------------------------------------------------------
    def _sync_lessons(self, module: Module, scanned: ScannedModule) -> dict[tuple, Lesson]:
        """Returns lessons keyed by (path, stem) so attachments can pair with them."""
        by_stem: dict[tuple, Lesson] = {}
        next_order = (module.lessons.aggregate(m=Max("order"))["m"] or 0) + 1
        for index, file in enumerate(_sort_files(scanned.videos)):
            if file.id in self.seen_lessons:  # same video reachable twice (e.g. via shortcut)
                continue
            self.seen_lessons.add(file.id)
            lesson = self.lessons.get(file.id)
            if module.lessons_order_is_custom and (lesson is None or lesson.module_id != module.pk):
                order, next_order = next_order, next_order + 1
            elif module.lessons_order_is_custom:
                order = lesson.order
            else:
                order = index
            lesson = self._upsert_lesson(lesson, module, file, order)
            by_stem[(tuple(file.path), stem_key(file.name))] = lesson
        return by_stem

    def _upsert_lesson(
        self, lesson: Lesson | None, module: Module, file: ScannedFile, order: int
    ) -> Lesson:
        title = _file_title(file, self.clean)
        fields = {
            "module": module,
            "drive_name_original": file.name,
            "drive_path": PATH_SEPARATOR.join(file.path),
            "mime_type": file.mime_type,
            "drive_modified_at": file.modified_at,
            "order": order,
            "missing_in_drive": False,
        }
        if file.duration_seconds is not None:
            fields["duration_seconds"] = file.duration_seconds

        if lesson is None:
            lesson = Lesson.objects.create(drive_file_id=file.id, title=title, **fields)
            self.lessons[file.id] = lesson
            self.stats.lessons_created += 1
            return lesson

        if lesson.missing_in_drive:
            self.stats.lessons_restored += 1
        if not lesson.title_is_custom:
            fields["title"] = title
        changed = [name for name, value in fields.items() if getattr(lesson, name) != value]
        if changed:
            for name in changed:
                setattr(lesson, name, fields[name])
            lesson.save(update_fields=changed)
            if set(changed) - {"order", "missing_in_drive"}:
                self.stats.lessons_updated += 1
        return lesson

    # --- attachments -------------------------------------------------------------------
    def _sync_attachments(
        self, module: Module, scanned: ScannedModule, lessons_by_stem: dict[tuple, Lesson]
    ) -> None:
        for index, file in enumerate(_sort_files(scanned.others)):
            if file.id in self.seen_attachments:
                continue
            self.seen_attachments.add(file.id)
            lesson = lessons_by_stem.get((tuple(file.path), stem_key(file.name)))
            owner = (
                {"lesson": lesson, "module": None} if lesson else {"lesson": None, "module": module}
            )
            values = {
                "title": _file_title(file, self.clean),
                "mime_type": file.mime_type,
                "order": index,
                **owner,
            }
            attachment = self.attachments.get(file.id)
            if attachment is None:
                Attachment.objects.create(drive_file_id=file.id, **values)
            else:
                for name, value in values.items():
                    setattr(attachment, name, value)
                attachment.save()
            self.stats.attachments += 1

    # --- disappearances --------------------------------------------------------------
    def _move_missing_lessons_last(self) -> None:
        """In naturally-ordered modules, lessons gone from the Drive go after the live ones
        (otherwise their stale order would collide with new lessons)."""
        for module in self.modules.values():
            if module.lessons_order_is_custom:
                continue
            in_module = [x for x in self.lessons.values() if x.module_id == module.pk]
            gone = sorted(
                (x for x in in_module if x.drive_file_id not in self.seen_lessons),
                key=lambda x: (x.order, x.pk),
            )
            if not gone:
                continue
            live = [x.order for x in in_module if x.drive_file_id in self.seen_lessons]
            base = max(live, default=-1) + 1
            for offset, lesson in enumerate(gone):
                if lesson.order != base + offset:
                    lesson.order = base + offset
                    lesson.save(update_fields=["order"])

    def _flag_missing(self) -> None:
        for folder_id, module in self.modules.items():
            if folder_id and folder_id not in self.seen_modules and not module.missing_in_drive:
                module.missing_in_drive = True
                module.save(update_fields=["missing_in_drive"])
                self.stats.modules_missing += 1
        for file_id, lesson in self.lessons.items():
            if file_id not in self.seen_lessons and not lesson.missing_in_drive:
                lesson.missing_in_drive = True
                lesson.save(update_fields=["missing_in_drive"])
                self.stats.lessons_missing += 1
        self._move_missing_lessons_last()
        gone = set(self.attachments) - self.seen_attachments
        if gone:
            Attachment.objects.filter(pk__in=[self.attachments[i].pk for i in gone]).delete()


def apply_scan(course: Course, scan: ScanResult) -> SyncStats:
    with transaction.atomic():
        return _Syncer(course, scan).run()
