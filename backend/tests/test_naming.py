import pytest

from apps.courses.naming import clean_title, extract_folder_id, is_video, natural_key, stem_key

FOLDER_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345"


@pytest.mark.parametrize(
    "value",
    [
        f"https://drive.google.com/drive/folders/{FOLDER_ID}",
        f"https://drive.google.com/drive/folders/{FOLDER_ID}?usp=sharing",
        f"https://drive.google.com/drive/u/1/folders/{FOLDER_ID}",
        f"https://drive.google.com/open?id={FOLDER_ID}",
        f"https://drive.google.com/folderview?id={FOLDER_ID}&usp=sharing",
        f"  {FOLDER_ID}  ",
    ],
)
def test_extract_folder_id(value):
    assert extract_folder_id(value) == FOLDER_ID


@pytest.mark.parametrize(
    "value",
    [
        "",
        "abc",
        "https://example.com/folders/1AbCdEfGhIjKlMnOpQ",
        "https://drive.google.com/drive/my-drive",
        "not a link at all",
    ],
)
def test_extract_folder_id_rejects(value):
    assert extract_folder_id(value) is None


def test_natural_sort():
    names = ["Aula 10", "aula 2", "Aula 1", "Módulo 3", "Modulo 10", "01 - Intro", "2 - Base"]
    assert sorted(names, key=natural_key) == [
        "01 - Intro",
        "2 - Base",
        "Aula 1",
        "aula 2",
        "Aula 10",
        "Módulo 3",
        "Modulo 10",
    ]


def test_natural_sort_hierarchical_numbers():
    assert sorted(["1.10 X", "1.2 X", "1.1 X"], key=natural_key) == ["1.1 X", "1.2 X", "1.10 X"]


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Aula_02__Variaveis.mp4", "Aula 02 Variaveis"),
        ("01 - 01 - Intro.mp4", "01 - Intro"),
        ("01. 01 - Intro.mp4", "01 - Intro"),
        ("1.1 Introdução.mp4", "1.1 Introdução"),
        ("10 - 10 Anos de carreira.mp4", "10 - 10 Anos de carreira"),
        ("Aula 1.2", "Aula 1.2"),
        ("  Espaços   demais .mkv", "Espaços demais"),
    ],
)
def test_clean_title(name, expected):
    assert clean_title(name, is_file=True) == expected


def test_clean_title_folder_keeps_dots():
    assert clean_title("Módulo_1.Fundamentos", is_file=False) == "Módulo 1.Fundamentos"


def test_stem_key_pairs_video_and_pdf():
    assert stem_key("Aula 2.mp4") == stem_key("aula_2.PDF")


@pytest.mark.parametrize(
    ("mime", "name", "expected"),
    [
        ("video/mp4", "x.mp4", True),
        ("video/quicktime", "x", True),
        ("application/octet-stream", "Aula.mkv", True),
        ("application/octet-stream", "dados.bin", False),
        ("application/pdf", "Aula.pdf", False),
    ],
)
def test_is_video(mime, name, expected):
    assert is_video(mime, name) is expected
