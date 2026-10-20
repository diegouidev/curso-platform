import pytest

from apps.courses.sync import drive_file_title


@pytest.mark.parametrize(
    ("name", "path", "clean", "expected"),
    [
        ("01 - Welcome - Parte 1.mp4", ["01 - Welcome"], True, "01 - Welcome - Parte 1"),
        ("Aula 3.mp4", ["Parte 1", "Extras"], True, "Parte 1 / Extras / Aula 3"),
        ("Extras2 - Bônus.mp4", ["Extras"], True, "Extras / Extras2 - Bônus"),  # not a word match
        ("extras - bônus.mp4", ["Extras"], True, "extras - bônus"),  # case-insensitive
        (
            "01 - Welcome - Parte 1.mp4",
            ["01 - Welcome"],
            False,
            "01 - Welcome / 01 - Welcome - Parte 1",
        ),  # only with title cleanup on
    ],
)
def test_file_title_drops_a_folder_the_name_repeats(name, path, clean, expected):
    assert drive_file_title(name, "video/mp4", path, clean=clean) == expected
