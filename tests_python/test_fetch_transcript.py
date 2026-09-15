from __future__ import annotations

import json
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import fetch_transcript as fetch_transcript_module
from scripts.fetch_transcript import fetch_transcript
from youtube_transcript_api import (
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)


VIDEO_ID = "dQw4w9WgXcQ"
PROJECT_ROOT = Path(__file__).resolve().parents[1]


class FakeSegment:
    def __init__(self, text: str = "Bonjour", start: float = 1.25, duration: float = 2.5):
        self.text = text
        self.start = start
        self.duration = duration


class FakeFetchedTranscript(list[FakeSegment]):
    def __init__(
        self,
        segments: list[FakeSegment],
        *,
        language_code: str = "fr",
        is_generated: bool = False,
    ) -> None:
        super().__init__(segments)
        self.language_code = language_code
        self.is_generated = is_generated


class FakeApi:
    def __init__(self, transcript: FakeFetchedTranscript | None = None):
        self.transcript = (
            transcript
            if transcript is not None
            else FakeFetchedTranscript([FakeSegment()])
        )
        self.calls: list[tuple[str, list[str]]] = []

    def fetch(self, video_id: str, languages: list[str]) -> FakeFetchedTranscript:
        self.calls.append((video_id, languages))
        return self.transcript


class FailingApi:
    def __init__(self, error: Exception):
        self.error = error

    def fetch(self, video_id: str, languages: list[str]) -> FakeFetchedTranscript:
        raise self.error


class FetchTranscriptTests(unittest.TestCase):
    def test_uses_french_then_english_language_fallback(self) -> None:
        api = FakeApi()

        with tempfile.TemporaryDirectory() as temp_dir:
            fetch_transcript(
                VIDEO_ID,
                languages=["fr", "en"],
                output=Path(temp_dir) / "transcript.json",
                api=api,
            )

        self.assertEqual(api.calls, [(VIDEO_ID, ["fr", "en"])])

    def test_strips_language_codes_before_calling_the_api(self) -> None:
        api = FakeApi()

        with tempfile.TemporaryDirectory() as temp_dir:
            fetch_transcript(
                VIDEO_ID,
                languages=[" fr ", "\ten\n"],
                output=Path(temp_dir) / "transcript.json",
                api=api,
            )

        self.assertEqual(api.calls, [(VIDEO_ID, ["fr", "en"])])

    def test_constructs_the_youtube_api_when_no_client_is_injected(self) -> None:
        api = FakeApi()

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch(
                "scripts.fetch_transcript.YouTubeTranscriptApi",
                return_value=api,
            ) as api_constructor:
                fetch_transcript(
                    VIDEO_ID,
                    languages=["fr", "en"],
                    output=Path(temp_dir) / "transcript.json",
                )

        api_constructor.assert_called_once_with()
        self.assertEqual(api.calls, [(VIDEO_ID, ["fr", "en"])])

    def test_normalizes_transcript_metadata_and_segments(self) -> None:
        transcript = FakeFetchedTranscript(
            [
                FakeSegment(text="Première ligne", start=0.0, duration=1.75),
                FakeSegment(text="Deuxième ligne", start=1.75, duration=3.25),
            ],
            language_code="en",
            is_generated=True,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            payload = fetch_transcript(
                VIDEO_ID,
                languages=["fr", "en"],
                output=Path(temp_dir) / "transcript.json",
                api=FakeApi(transcript),
            )

        self.assertEqual(
            payload,
            {
                "schemaVersion": 1,
                "videoId": VIDEO_ID,
                "language": "en",
                "isGenerated": True,
                "segments": [
                    {"text": "Première ligne", "start": 0.0, "duration": 1.75},
                    {"text": "Deuxième ligne", "start": 1.75, "duration": 3.25},
                ],
            },
        )

    def test_writes_json_atomically_in_a_created_parent_directory(self) -> None:
        real_replace = os.replace
        replaced_payloads: list[dict[str, object]] = []

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "cache" / "transcripts" / "video.json"

            def inspect_then_replace(source: str | os.PathLike[str], target: str | os.PathLike[str]) -> None:
                source_path = Path(source)
                target_path = Path(target)
                self.assertEqual(source_path.parent, output.parent)
                self.assertNotEqual(source_path, target_path)
                self.assertTrue(source_path.is_file())
                replaced_payloads.append(
                    json.loads(source_path.read_text(encoding="utf-8"))
                )
                real_replace(source_path, target_path)

            with patch("os.replace", side_effect=inspect_then_replace) as replace_mock:
                payload = fetch_transcript(
                    VIDEO_ID,
                    languages=["fr", "en"],
                    output=output,
                    api=FakeApi(),
                )

            self.assertEqual(replace_mock.call_count, 1)
            self.assertEqual(replaced_payloads, [payload])
            self.assertEqual(
                json.loads(output.read_text(encoding="utf-8")),
                payload,
            )
            self.assertEqual(list(output.parent.iterdir()), [output])

    def test_json_dump_failure_cleans_temporary_file_and_preserves_destination(
        self,
    ) -> None:
        initial_content = b'{"preserved": true}\n'
        stderr = io.StringIO()

        def fail_after_partial_write(
            _payload: object,
            temporary_file: io.TextIOBase,
            **_kwargs: object,
        ) -> None:
            temporary_file.write('{"schemaVersion":')
            raise TypeError("détail interne de sérialisation")

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            output.write_bytes(initial_content)

            with patch(
                "scripts.fetch_transcript.json.dump",
                side_effect=fail_after_partial_write,
            ):
                exit_code = fetch_transcript_module.main(
                    [VIDEO_ID, "--output", str(output)],
                    api=FakeApi(),
                    stderr=stderr,
                )

            self.assertEqual(output.read_bytes(), initial_content)
            self.assertEqual(list(output.parent.iterdir()), [output])

        self.assertEqual(exit_code, 4)
        self.assertEqual(json.loads(stderr.getvalue())["code"], "technical_error")

    def test_os_replace_failure_cleans_temporary_file_and_preserves_destination(
        self,
    ) -> None:
        initial_content = b'{"preserved": true}\n'
        stderr = io.StringIO()

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            output.write_bytes(initial_content)

            with patch(
                "scripts.fetch_transcript.os.replace",
                side_effect=OSError("détail interne de remplacement"),
            ):
                exit_code = fetch_transcript_module.main(
                    [VIDEO_ID, "--output", str(output)],
                    api=FakeApi(),
                    stderr=stderr,
                )

            self.assertEqual(output.read_bytes(), initial_content)
            self.assertEqual(list(output.parent.iterdir()), [output])

        self.assertEqual(exit_code, 4)
        self.assertEqual(json.loads(stderr.getvalue())["code"], "technical_error")

    def test_rejects_an_empty_transcript_without_writing_output(self) -> None:
        api = FakeApi(FakeFetchedTranscript([]))

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with self.assertRaises(RuntimeError) as raised:
                fetch_transcript(
                    VIDEO_ID,
                    languages=["fr", "en"],
                    output=output,
                    api=api,
                )

            self.assertEqual(raised.exception.args, ("La transcription récupérée est vide.",))
            self.assertEqual(
                getattr(raised.exception, "code", None),
                "transcript_not_found",
            )
            self.assertFalse(getattr(raised.exception, "retryable", True))
            self.assertFalse(output.exists())

    def test_validates_video_id_before_calling_the_api(self) -> None:
        invalid_video_ids = ["", "trop-court", "dQw4w9WgXc?", "https://youtu.be/dQw4w9WgXcQ"]

        for invalid_video_id in invalid_video_ids:
            with self.subTest(video_id=invalid_video_id):
                api = FakeApi()
                with tempfile.TemporaryDirectory() as temp_dir:
                    output = Path(temp_dir) / "transcript.json"
                    with self.assertRaises(RuntimeError) as raised:
                        fetch_transcript(
                            invalid_video_id,
                            languages=["fr", "en"],
                            output=output,
                            api=api,
                        )

                    self.assertEqual(
                        raised.exception.args,
                        ("Identifiant vidéo YouTube invalide.",),
                    )
                    self.assertEqual(
                        getattr(raised.exception, "code", None),
                        "invalid_video_id",
                    )
                    self.assertFalse(getattr(raised.exception, "retryable", True))
                    self.assertEqual(api.calls, [])
                    self.assertFalse(output.exists())

    def test_rejects_an_empty_language_list_before_constructing_the_api(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with patch(
                "scripts.fetch_transcript.YouTubeTranscriptApi"
            ) as api_constructor:
                with self.assertRaises(
                    fetch_transcript_module.TranscriptFetchError
                ) as raised:
                    fetch_transcript(
                        VIDEO_ID,
                        languages=[],
                        output=output,
                    )

            self.assertEqual(
                raised.exception.args,
                ("La liste des langues ne peut pas être vide.",),
            )
            self.assertEqual(raised.exception.code, "invalid_languages")
            self.assertFalse(raised.exception.retryable)
            api_constructor.assert_not_called()
            self.assertFalse(output.exists())

    def test_rejects_a_language_code_empty_after_stripping_before_constructing_the_api(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with patch(
                "scripts.fetch_transcript.YouTubeTranscriptApi"
            ) as api_constructor:
                with self.assertRaises(
                    fetch_transcript_module.TranscriptFetchError
                ) as raised:
                    fetch_transcript(
                        VIDEO_ID,
                        languages=["fr", " \t\n", "en"],
                        output=output,
                    )

            self.assertEqual(
                raised.exception.args,
                ("La liste des langues contient un code vide.",),
            )
            self.assertEqual(raised.exception.code, "invalid_languages")
            self.assertFalse(raised.exception.retryable)
            api_constructor.assert_not_called()
            self.assertFalse(output.exists())

    def test_rejects_an_empty_language_code_before_calling_the_api(self) -> None:
        api = FakeApi()

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with self.assertRaises(
                fetch_transcript_module.TranscriptFetchError
            ) as raised:
                fetch_transcript(
                    VIDEO_ID,
                    languages=["fr", "", "en"],
                    output=output,
                    api=api,
                )

            self.assertEqual(
                raised.exception.args,
                ("La liste des langues contient un code vide.",),
            )
            self.assertEqual(raised.exception.code, "invalid_languages")
            self.assertFalse(raised.exception.retryable)
            self.assertEqual(api.calls, [])
            self.assertFalse(output.exists())

    def test_maps_disabled_transcripts_to_a_stable_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with self.assertRaises(Exception) as raised:
                fetch_transcript(
                    VIDEO_ID,
                    languages=["fr", "en"],
                    output=output,
                    api=FailingApi(TranscriptsDisabled(VIDEO_ID)),
                )

            self.assertEqual(raised.exception.__class__.__name__, "TranscriptFetchError")
            self.assertEqual(
                raised.exception.args,
                ("Les transcriptions sont désactivées pour cette vidéo.",),
            )
            self.assertEqual(
                getattr(raised.exception, "code", None),
                "transcript_disabled",
            )
            self.assertFalse(getattr(raised.exception, "retryable", True))
            self.assertFalse(output.exists())

    def test_maps_missing_transcripts_to_a_stable_error(self) -> None:
        api_error = NoTranscriptFound(VIDEO_ID, ["fr", "en"], object())

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with self.assertRaises(Exception) as raised:
                fetch_transcript(
                    VIDEO_ID,
                    languages=["fr", "en"],
                    output=output,
                    api=FailingApi(api_error),
                )

            self.assertEqual(raised.exception.__class__.__name__, "TranscriptFetchError")
            self.assertEqual(
                raised.exception.args,
                ("Aucune transcription trouvée dans les langues demandées.",),
            )
            self.assertEqual(
                getattr(raised.exception, "code", None),
                "transcript_not_found",
            )
            self.assertFalse(getattr(raised.exception, "retryable", True))
            self.assertFalse(output.exists())

    def test_maps_an_unavailable_video_to_a_stable_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with self.assertRaises(Exception) as raised:
                fetch_transcript(
                    VIDEO_ID,
                    languages=["fr", "en"],
                    output=output,
                    api=FailingApi(VideoUnavailable(VIDEO_ID)),
                )

            self.assertIsInstance(
                raised.exception,
                fetch_transcript_module.TranscriptFetchError,
            )
            self.assertEqual(
                raised.exception.args,
                ("La vidéo demandée n’est pas disponible.",),
            )
            self.assertEqual(
                getattr(raised.exception, "code", None),
                "video_unavailable",
            )
            self.assertFalse(getattr(raised.exception, "retryable", True))
            self.assertFalse(output.exists())

    def test_maps_blocked_requests_to_a_retryable_rate_limit_error(self) -> None:
        for api_error in (RequestBlocked(VIDEO_ID), IpBlocked(VIDEO_ID)):
            with self.subTest(error=api_error.__class__.__name__):
                with tempfile.TemporaryDirectory() as temp_dir:
                    output = Path(temp_dir) / "transcript.json"
                    with self.assertRaises(Exception) as raised:
                        fetch_transcript(
                            VIDEO_ID,
                            languages=["fr", "en"],
                            output=output,
                            api=FailingApi(api_error),
                        )

                    self.assertEqual(
                        raised.exception.__class__.__name__,
                        "TranscriptFetchError",
                    )
                    self.assertEqual(
                        raised.exception.args,
                        ("Les requêtes vers YouTube sont temporairement limitées.",),
                    )
                    self.assertEqual(
                        getattr(raised.exception, "code", None),
                        "rate_limited",
                    )
                    self.assertTrue(
                        getattr(raised.exception, "retryable", False)
                    )
                    self.assertFalse(output.exists())

    def test_cli_fetches_with_exact_arguments_and_returns_zero(self) -> None:
        api = FakeApi()
        stderr = io.StringIO()

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            exit_code = fetch_transcript_module.main(
                [
                    VIDEO_ID,
                    "--languages",
                    "fr,en",
                    "--output",
                    str(output),
                ],
                api=api,
                stderr=stderr,
            )

            written_payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(api.calls, [(VIDEO_ID, ["fr", "en"])])
        self.assertEqual(written_payload["schemaVersion"], 1)
        self.assertEqual(written_payload["videoId"], VIDEO_ID)
        self.assertEqual(stderr.getvalue(), "")

    def test_cli_delegates_language_normalization_to_fetch_transcript(self) -> None:
        api = FakeApi()
        stderr = io.StringIO()

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with patch(
                "scripts.fetch_transcript.fetch_transcript"
            ) as fetch_mock:
                exit_code = fetch_transcript_module.main(
                    [
                        VIDEO_ID,
                        "--languages",
                        " fr , en ",
                        "--output",
                        str(output),
                    ],
                    api=api,
                    stderr=stderr,
                )

        self.assertEqual(exit_code, 0)
        fetch_mock.assert_called_once_with(
            VIDEO_ID,
            languages=[" fr ", " en "],
            output=output,
            api=api,
        )
        self.assertEqual(stderr.getvalue(), "")

    def test_cli_strips_whitespace_around_language_commas(self) -> None:
        api = FakeApi()

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            exit_code = fetch_transcript_module.main(
                [
                    VIDEO_ID,
                    "--languages",
                    " fr , en ",
                    "--output",
                    str(output),
                ],
                api=api,
                stderr=io.StringIO(),
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(api.calls, [(VIDEO_ID, ["fr", "en"])])

    def test_cli_defaults_to_french_then_english(self) -> None:
        api = FakeApi()

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            exit_code = fetch_transcript_module.main(
                [VIDEO_ID, "--output", str(output)],
                api=api,
                stderr=io.StringIO(),
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(api.calls, [(VIDEO_ID, ["fr", "en"])])

    def test_cli_writes_known_errors_as_json_without_a_traceback(self) -> None:
        cases = [
            (
                TranscriptsDisabled(VIDEO_ID),
                "transcript_disabled",
                False,
                "Les transcriptions sont désactivées pour cette vidéo.",
            ),
            (
                NoTranscriptFound(VIDEO_ID, ["fr", "en"], object()),
                "transcript_not_found",
                False,
                "Aucune transcription trouvée dans les langues demandées.",
            ),
            (
                RequestBlocked(VIDEO_ID),
                "rate_limited",
                True,
                "Les requêtes vers YouTube sont temporairement limitées.",
            ),
            (
                IpBlocked(VIDEO_ID),
                "rate_limited",
                True,
                "Les requêtes vers YouTube sont temporairement limitées.",
            ),
            (
                VideoUnavailable(VIDEO_ID),
                "video_unavailable",
                False,
                "La vidéo demandée n’est pas disponible.",
            ),
        ]

        for api_error, code, retryable, message in cases:
            with self.subTest(error=api_error.__class__.__name__, code=code):
                stderr = io.StringIO()
                with tempfile.TemporaryDirectory() as temp_dir:
                    output = Path(temp_dir) / "transcript.json"
                    exit_code = fetch_transcript_module.main(
                        [VIDEO_ID, "--output", str(output)],
                        api=FailingApi(api_error),
                        stderr=stderr,
                    )

                    self.assertFalse(output.exists())

                error_output = stderr.getvalue()
                self.assertNotIn("Traceback", error_output)
                self.assertEqual(
                    json.loads(error_output),
                    {
                        "videoId": VIDEO_ID,
                        "code": code,
                        "retryable": retryable,
                        "message": message,
                    },
                )
                self.assertEqual(exit_code, 3)

    def test_cli_writes_unexpected_errors_as_sanitized_json(self) -> None:
        stderr = io.StringIO()
        internal_detail = "Échec interne dans /tmp/transcription-secrete.json"

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            with patch(
                "scripts.fetch_transcript.fetch_transcript",
                side_effect=RuntimeError(internal_detail),
            ):
                exit_code = fetch_transcript_module.main(
                    [VIDEO_ID, "--output", str(output)],
                    stderr=stderr,
                )

        error_output = stderr.getvalue()
        self.assertNotIn("Traceback", error_output)
        self.assertNotIn(internal_detail, error_output)
        self.assertNotIn(str(output), error_output)
        self.assertEqual(
            json.loads(error_output),
            {
                "videoId": VIDEO_ID,
                "code": "technical_error",
                "retryable": False,
                "message": "Une erreur technique interne est survenue.",
            },
        )
        self.assertEqual(exit_code, 4)

    def test_cli_help_is_entirely_in_french(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                str(PROJECT_ROOT / "scripts" / "fetch-transcript.py"),
                "--help",
            ],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, "")
        for french_text in (
            "utilisation :",
            "arguments positionnels :",
            "identifiant de la vidéo YouTube",
            "codes de langue séparés par des virgules",
            "chemin du fichier JSON à écrire",
            "afficher cette aide et quitter",
        ):
            with self.subTest(text=french_text):
                self.assertIn(french_text, completed.stdout)
        for english_text in (
            "usage:",
            "positional arguments:",
            "show this help message and exit",
        ):
            with self.subTest(text=english_text):
                self.assertNotIn(english_text, completed.stdout)

    def test_cli_required_argument_errors_are_entirely_in_french(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            cases = (
                ([], "IDENTIFIANT_VIDEO, --output"),
                ([VIDEO_ID], "--output"),
                (["--output", str(output)], "IDENTIFIANT_VIDEO"),
            )

            for arguments, missing_arguments in cases:
                with self.subTest(arguments=arguments):
                    completed = subprocess.run(
                        [
                            sys.executable,
                            str(PROJECT_ROOT / "scripts" / "fetch-transcript.py"),
                            *arguments,
                        ],
                        cwd=PROJECT_ROOT,
                        capture_output=True,
                        text=True,
                        check=False,
                    )

                    self.assertEqual(completed.returncode, 2)
                    self.assertEqual(completed.stdout, "")
                    self.assertIn("utilisation :", completed.stderr)
                    self.assertIn(
                        "erreur : les arguments suivants sont requis : "
                        f"{missing_arguments}\n",
                        completed.stderr,
                    )
                    self.assertNotIn("usage:", completed.stderr)
                    self.assertNotIn("error:", completed.stderr)
                    self.assertNotIn(
                        "the following arguments are required:",
                        completed.stderr,
                    )
                    self.assertNotIn("Traceback", completed.stderr)

    def test_cli_options_without_values_are_entirely_in_french(self) -> None:
        cases = (
            ([VIDEO_ID, "--output"], "--output"),
            (
                [VIDEO_ID, "--output", "sortie.json", "--languages"],
                "--languages",
            ),
        )

        for arguments, option in cases:
            with self.subTest(option=option):
                completed = subprocess.run(
                    [
                        sys.executable,
                        str(PROJECT_ROOT / "scripts" / "fetch-transcript.py"),
                        *arguments,
                    ],
                    cwd=PROJECT_ROOT,
                    capture_output=True,
                    text=True,
                    check=False,
                )

                self.assertEqual(completed.returncode, 2)
                self.assertEqual(completed.stdout, "")
                self.assertIn("utilisation :", completed.stderr)
                self.assertIn(
                    f"erreur : l’option {option} requiert une valeur\n",
                    completed.stderr,
                )
                self.assertNotIn("expected one argument", completed.stderr)
                self.assertNotIn("usage:", completed.stderr)
                self.assertNotIn("error:", completed.stderr)
                self.assertNotIn("Traceback", completed.stderr)

    def test_cli_other_argument_errors_use_a_french_fallback(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                str(PROJECT_ROOT / "scripts" / "fetch-transcript.py"),
                "--help=oui",
            ],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, "")
        self.assertIn("utilisation :", completed.stderr)
        self.assertIn(
            "erreur : arguments de ligne de commande invalides\n",
            completed.stderr,
        )
        self.assertNotIn("ignored explicit argument", completed.stderr)
        self.assertNotIn("usage:", completed.stderr)
        self.assertNotIn("error:", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)

    def test_cli_unknown_option_errors_are_entirely_in_french(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(PROJECT_ROOT / "scripts" / "fetch-transcript.py"),
                    VIDEO_ID,
                    "--output",
                    str(output),
                    "--inconnue",
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, "")
        self.assertIn("utilisation :", completed.stderr)
        self.assertIn(
            "erreur : arguments non reconnus : --inconnue\n",
            completed.stderr,
        )
        self.assertNotIn("unrecognized arguments:", completed.stderr)
        self.assertNotIn("usage:", completed.stderr)
        self.assertNotIn("error:", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)

    def test_hyphenated_cli_wrapper_exits_with_main_status(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "transcript.json"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(PROJECT_ROOT / "scripts" / "fetch-transcript.py"),
                    "invalid",
                    "--output",
                    str(output),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertFalse(output.exists())

        self.assertEqual(completed.returncode, 3)
        self.assertEqual(completed.stdout, "")
        self.assertNotIn("Traceback", completed.stderr)
        self.assertEqual(
            json.loads(completed.stderr),
            {
                "videoId": "invalid",
                "code": "invalid_video_id",
                "retryable": False,
                "message": "Identifiant vidéo YouTube invalide.",
            },
        )


if __name__ == "__main__":
    unittest.main()
