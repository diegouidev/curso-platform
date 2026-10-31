import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE = [("courses", "0002_study_sessions_and_preferences")]
AFTER = [("courses", "0003_lesson_section")]


def migrate(target):
    executor = MigrationExecutor(connection)
    executor.migrate(target)
    return executor.loader.project_state(target).apps


@pytest.mark.django_db(transaction=True)
def test_first_sub_folder_moves_from_the_title_to_the_section():
    try:
        apps = migrate(BEFORE)
        Course = apps.get_model("courses", "Course")
        Module = apps.get_model("courses", "Module")
        Lesson = apps.get_model("courses", "Lesson")
        course = Course.objects.create(title="Curso", drive_folder_id="root", clean_titles=True)
        module = Module.objects.create(course=course, title="Módulo", drive_folder_id="m1")
        for file_id, name, path, title, custom in [
            ("loose", "Aula 1.mp4", "", "Aula 1", False),
            ("one", "02_Aula.mp4", "Módulo_01", "Módulo 01 / 02 Aula", False),
            ("deep", "Aula 3.mp4", "Parte 1 / Extras", "Parte 1 / Extras / Aula 3", False),
            ("custom", "Aula 4.mp4", "Parte 1", "Minha aula", True),
        ]:
            Lesson.objects.create(
                module=module,
                drive_file_id=file_id,
                drive_name_original=name,
                drive_path=path,
                title=title,
                title_is_custom=custom,
                mime_type="video/mp4",
            )

        Lesson = migrate(AFTER).get_model("courses", "Lesson")

        values = Lesson.objects.values_list("drive_file_id", "section", "title")
        rows = {file_id: rest for file_id, *rest in values}
        assert rows == {
            "loose": ["", "Aula 1"],
            "one": ["Módulo 01", "02 Aula"],
            "deep": ["Parte 1", "Extras / Aula 3"],
            "custom": ["Parte 1", "Minha aula"],
        }
    finally:
        migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())
