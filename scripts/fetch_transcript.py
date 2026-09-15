from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, NoReturn, Sequence, TextIO

from youtube_transcript_api import (
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)


VIDEO_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{11}")


class FrenchArgumentParser(argparse.ArgumentParser):
    def format_help(self) -> str:
        return super().format_help().replace("usage: ", "utilisation : ", 1)

    def format_usage(self) -> str:
        return super().format_usage().replace("usage: ", "utilisation : ", 1)

    def error(self, message: str) -> NoReturn:
        required_prefix = "the following arguments are required:"
        unrecognized_prefix = "unrecognized arguments:"
        missing_value_match = re.fullmatch(
            r"argument (.+): expected one argument",
            message,
        )
        if message.startswith(required_prefix):
            missing_arguments = message.removeprefix(required_prefix).strip()
            message = f"les arguments suivants sont requis : {missing_arguments}"
        elif message.startswith(unrecognized_prefix):
            arguments = message.removeprefix(unrecognized_prefix).strip()
            message = f"arguments non reconnus : {arguments}"
        elif missing_value_match is not None:
            option = missing_value_match.group(1)
            message = f"l’option {option} requiert une valeur"
        else:
            message = "arguments de ligne de commande invalides"
        self.print_usage(sys.stderr)
        self.exit(2, f"{self.prog}: erreur : {message}\n")


class TranscriptFetchError(RuntimeError):
    def __init__(self, message: str, *, code: str, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def fetch_transcript(
    video_id: str,
    languages: Sequence[str],
    output: Path | str,
    *,
    api: Any | None = None,
) -> Any:
    if VIDEO_ID_PATTERN.fullmatch(video_id) is None:
        raise TranscriptFetchError(
            "Identifiant vidéo YouTube invalide.",
            code="invalid_video_id",
            retryable=False,
        )
    if not languages:
        raise TranscriptFetchError(
            "La liste des langues ne peut pas être vide.",
            code="invalid_languages",
            retryable=False,
        )
    normalized_languages = [language.strip() for language in languages]
    if any(not language for language in normalized_languages):
        raise TranscriptFetchError(
            "La liste des langues contient un code vide.",
            code="invalid_languages",
            retryable=False,
        )

    client = api if api is not None else YouTubeTranscriptApi()
    try:
        transcript = client.fetch(video_id, languages=normalized_languages)
    except TranscriptsDisabled:
        raise TranscriptFetchError(
            "Les transcriptions sont désactivées pour cette vidéo.",
            code="transcript_disabled",
            retryable=False,
        ) from None
    except NoTranscriptFound:
        raise TranscriptFetchError(
            "Aucune transcription trouvée dans les langues demandées.",
            code="transcript_not_found",
            retryable=False,
        ) from None
    except RequestBlocked:
        raise TranscriptFetchError(
            "Les requêtes vers YouTube sont temporairement limitées.",
            code="rate_limited",
            retryable=True,
        ) from None
    except VideoUnavailable:
        raise TranscriptFetchError(
            "La vidéo demandée n’est pas disponible.",
            code="video_unavailable",
            retryable=False,
        ) from None
    segments = list(transcript)
    if not segments:
        raise TranscriptFetchError(
            "La transcription récupérée est vide.",
            code="transcript_not_found",
            retryable=False,
        )
    payload = {
        "schemaVersion": 1,
        "videoId": video_id,
        "language": transcript.language_code,
        "isGenerated": transcript.is_generated,
        "segments": [
            {"text": segment.text, "start": segment.start, "duration": segment.duration}
            for segment in segments
        ],
    }

    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(payload, temporary_file, ensure_ascii=False)
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, output_path)
    except BaseException:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise

    return payload


def main(
    argv: Sequence[str] | None = None,
    *,
    api: Any | None = None,
    stderr: TextIO | None = None,
) -> int:
    parser = FrenchArgumentParser(
        add_help=False,
        description=(
            "Récupère une transcription YouTube et l’enregistre au format JSON."
        ),
    )
    parser._positionals.title = "arguments positionnels :"
    parser._optionals.title = "options :"
    parser.add_argument(
        "-h",
        "--help",
        action="help",
        help="afficher cette aide et quitter",
    )
    parser.add_argument(
        "video_id",
        metavar="IDENTIFIANT_VIDEO",
        help="identifiant de la vidéo YouTube",
    )
    parser.add_argument(
        "--languages",
        default="fr,en",
        metavar="LANGUES",
        help="codes de langue séparés par des virgules (par défaut : fr,en)",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        metavar="CHEMIN",
        help="chemin du fichier JSON à écrire",
    )
    arguments = parser.parse_args(argv)

    try:
        fetch_transcript(
            arguments.video_id,
            languages=arguments.languages.split(","),
            output=arguments.output,
            api=api,
        )
    except TranscriptFetchError as error:
        error_payload = {
            "videoId": arguments.video_id,
            "code": error.code,
            "retryable": error.retryable,
            "message": str(error),
        }
        print(
            json.dumps(error_payload, ensure_ascii=False),
            file=stderr if stderr is not None else sys.stderr,
        )
        return 3
    except Exception:
        error_payload = {
            "videoId": arguments.video_id,
            "code": "technical_error",
            "retryable": False,
            "message": "Une erreur technique interne est survenue.",
        }
        print(
            json.dumps(error_payload, ensure_ascii=False),
            file=stderr if stderr is not None else sys.stderr,
        )
        return 4
    return 0
