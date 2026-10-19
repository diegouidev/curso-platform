"""User organization of a course: titles, hidden items and custom order.

Drive data is never touched; these only change how the course is shown here. Sync keeps
custom titles (`title_is_custom`) and custom order (`*_order_is_custom`).
"""

from django.db import transaction
from rest_framework import status

from apps.core.exceptions import AppError

from .models import Course, Lesson, Module
from .naming import natural_key, path_key
from .sync import PATH_SEPARATOR, drive_file_title, drive_module_title


class InvalidOrder(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "invalid_order"
    message = "A nova ordem precisa conter exatamente os itens atuais, sem repetir."


def _lesson_path(lesson: Lesson) -> list[str]:
    return lesson.drive_path.split(PATH_SEPARATOR) if lesson.drive_path else []


def drive_title_of_lesson(lesson: Lesson) -> str:
    return drive_file_title(
        lesson.drive_name_original,
        lesson.mime_type,
        _lesson_path(lesson),
        clean=lesson.module.course.clean_titles,
    )


def drive_title_of_module(module: Module) -> str:
    course = module.course
    return drive_module_title(
        module.drive_name_original or module.title,
        is_root=module.drive_folder_id == course.drive_folder_id,
        clean=course.clean_titles,
    )


def set_title(item: Module | Lesson, title: str) -> None:
    """A non-empty title becomes custom; an empty one restores the Drive-derived title."""
    title = title.strip()
    if title:
        item.title, item.title_is_custom = title, True
    else:
        restored = (
            drive_title_of_lesson(item) if isinstance(item, Lesson) else drive_title_of_module(item)
        )
        item.title, item.title_is_custom = restored, False


def reorder(kind: str, parent_id: int, ids: list[int]) -> None:
    """Saves a drag-and-drop order. `ids` must be every child of the parent, once."""
    with transaction.atomic():
        if kind == "modules":
            parent = Course.objects.select_for_update().get(pk=parent_id)
            children = Module.objects.filter(course=parent)
        else:
            parent = Module.objects.select_for_update().get(pk=parent_id)
            children = Lesson.objects.filter(module=parent)
        current = set(children.values_list("pk", flat=True))
        if len(ids) != len(set(ids)) or set(ids) != current:
            raise InvalidOrder()
        model = Module if kind == "modules" else Lesson
        items = list(model.objects.filter(pk__in=ids))
        position = {pk: index for index, pk in enumerate(ids)}
        for item in items:
            item.order = position[item.pk]
        model.objects.bulk_update(items, ["order"])
        if kind == "modules":
            parent.modules_order_is_custom = True
            parent.save(update_fields=["modules_order_is_custom"])
        else:
            parent.lessons_order_is_custom = True
            parent.save(update_fields=["lessons_order_is_custom"])


def reset_order(course: Course) -> None:
    """Back to the Drive's natural order (the same rules as the import), right away."""
    with transaction.atomic():
        modules = list(course.modules.all())
        modules.sort(
            key=lambda m: (
                m.missing_in_drive,
                m.drive_folder_id != course.drive_folder_id,  # "Geral" first
                natural_key(m.drive_name_original or m.title),
            )
        )
        for index, module in enumerate(modules):
            module.order = index
            module.lessons_order_is_custom = False
        Module.objects.bulk_update(modules, ["order", "lessons_order_is_custom"])

        lessons = list(Lesson.objects.filter(module__course=course))
        by_module: dict[int, list[Lesson]] = {}
        for lesson in lessons:
            by_module.setdefault(lesson.module_id, []).append(lesson)
        for items in by_module.values():
            items.sort(
                key=lambda x: (
                    x.missing_in_drive,
                    path_key([*_lesson_path(x), x.drive_name_original]),
                )
            )
            for index, lesson in enumerate(items):
                lesson.order = index
        Lesson.objects.bulk_update(lessons, ["order"])

        course.modules_order_is_custom = False
        course.save(update_fields=["modules_order_is_custom"])
