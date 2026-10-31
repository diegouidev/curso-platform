from django.db import migrations, models

from apps.courses.sync import PATH_SEPARATOR, drive_file_title, drive_lesson_titles


def _nested_lessons(apps):
    Lesson = apps.get_model("courses", "Lesson")
    return Lesson, list(Lesson.objects.exclude(drive_path="").select_related("module__course"))


def split_sections(apps, schema_editor):
    """The first sub-folder moves from the title prefix to `section`; custom titles stay."""
    Lesson, lessons = _nested_lessons(apps)
    for lesson in lessons:
        section, title = drive_lesson_titles(
            lesson.drive_name_original,
            lesson.mime_type,
            lesson.drive_path.split(PATH_SEPARATOR),
            clean=lesson.module.course.clean_titles,
        )
        lesson.section = section
        if not lesson.title_is_custom:
            lesson.title = title
    Lesson.objects.bulk_update(lessons, ["section", "title"], batch_size=500)


def join_sections(apps, schema_editor):
    Lesson, lessons = _nested_lessons(apps)
    lessons = [lesson for lesson in lessons if not lesson.title_is_custom]
    for lesson in lessons:
        lesson.title = drive_file_title(
            lesson.drive_name_original,
            lesson.mime_type,
            lesson.drive_path.split(PATH_SEPARATOR),
            clean=lesson.module.course.clean_titles,
        )
    Lesson.objects.bulk_update(lessons, ["title"], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ("courses", "0002_study_sessions_and_preferences"),
    ]

    operations = [
        migrations.AddField(
            model_name="lesson",
            name="section",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.RunPython(split_sections, join_sections),
    ]
