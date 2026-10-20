"""The fake Google Drive served to the E2E stack: one course folder, read-only checks on.

Reuses tests.fakes.FakeDrive, which asserts on every call that only read endpoints with
the shared-drive parameters are used.
"""

from tests.fakes import FakeDrive

COURSE_FOLDER_ID = "E2E-course-root-0001"
COURSE_LINK = f"https://drive.google.com/drive/folders/{COURSE_FOLDER_ID}?usp=sharing"
ACCOUNT_EMAIL = "aluno.e2e@example.com"
# Exercises truncation (ellipsis) in narrow layouts.
LONG_TITLE = "Aula 3 - Um título bem longo para garantir que nomes enormes de aula são cortados com reticências"


def build_fake_drive() -> FakeDrive:
    """
    Curso E2E de Python/
      00 - Boas-vindas.mp4 (1:30)          -> "Geral"
      Leia-me.pdf                          -> attachment of "Geral"
      Módulo 1 - Fundamentos/
        01 - Introdução.mp4 (0:40)
        02 - Variáveis.mp4 (5:00) + 02 - Variáveis.pdf
        10 - Revisão.mp4 (2:00)
      Módulo 2 - Prática/
        Aula 1.mp4 (3:00), Aula 2.mp4 (4:00), Aula 3 - <very long title>.mp4 (2:30)
        Extras/Extras - Bônus.mp4 (1:00)   -> "Bônus" folder prefix is dropped
    """
    drive = FakeDrive(page_size=3, email=ACCOUNT_EMAIL)
    root = drive.folder(COURSE_FOLDER_ID, "Curso E2E de Python")
    drive.file("e2e-welcome-video", "00 - Boas-vindas.mp4", root, duration_ms=90_000)
    drive.file("e2e-readme-pdf-01", "Leia-me.pdf", root, mime="application/pdf")

    m1 = drive.folder("e2e-module-1-fund", "Módulo 1 - Fundamentos", root)
    drive.file("e2e-m1-intro-video", "01 - Introdução.mp4", m1, duration_ms=40_000)
    drive.file("e2e-m1-vars-video", "02 - Variáveis.mp4", m1, duration_ms=300_000)
    drive.file("e2e-m1-vars-pdf-01", "02 - Variáveis.pdf", m1, mime="application/pdf")
    drive.file("e2e-m1-review-video", "10 - Revisão.mp4", m1, duration_ms=120_000)

    m2 = drive.folder("e2e-module-2-prat", "Módulo 2 - Prática", root)
    drive.file("e2e-m2-aula1-video", "Aula 1.mp4", m2, duration_ms=180_000)
    drive.file("e2e-m2-aula2-video", "Aula 2.mp4", m2, duration_ms=240_000)
    drive.file("e2e-m2-aula3-video", f"{LONG_TITLE}.mp4", m2, duration_ms=150_000)
    extras = drive.folder("e2e-m2-extras-dir", "Extras", m2)
    drive.file("e2e-m2-bonus-video", "Extras - Bônus.mp4", extras, duration_ms=60_000)
    return drive


# One instance per process: the tree never changes during a run.
FAKE_DRIVE = build_fake_drive()
