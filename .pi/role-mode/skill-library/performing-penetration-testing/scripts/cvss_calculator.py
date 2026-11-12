#!/usr/bin/env python3
"""
CVSS Score Calculator

Calculates CVSS (Common Vulnerability Scoring System) scores for versions 2.0, 3.x, and 4.0
using the official Red Hat CVSS library. Supports interactive mode, command-line arguments,
and batch processing from files.

Requirements:
    pip install cvss

Usage:
    # Calculate score from vector string
    python cvss_calculator.py "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"

    # Interactive mode
    python cvss_calculator.py --interactive

    # Batch processing from file
    python cvss_calculator.py --file vectors.txt

    # Output as JSON
    python cvss_calculator.py --json "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"

Author: Backendhance
License: MIT
"""

import argparse
import json
import sys
from typing import Optional

try:
    from cvss import CVSS2, CVSS3, CVSS4
except ImportError:
    print(
        "Error: cvss library not installed. Install with: pip install cvss",
        file=sys.stderr,
    )
    sys.exit(1)


def detect_cvss_version(vector: str) -> Optional[str]:
    """
    Detect CVSS version from vector string.

    Returns:
        'v2', 'v3', 'v4', or None if unknown
    """
    vector = vector.strip()
    if vector.startswith("CVSS:4.0/"):
        return "v4"
    if vector.startswith("CVSS:3."):
        return "v3"
    if "/" in vector and not vector.startswith("CVSS:"):
        return "v2"
    return None


def calculate_cvss_score(vector: str) -> dict:
    """
    Calculate CVSS score from a vector string.

    Supports CVSS v2, v3.0, v3.1, and v4.0.

    Returns:
        Dictionary with score details including:
        - version: CVSS version
        - vector: cleaned vector string
        - scores: tuple of scores (base, temporal, environmental) or (score,) for v4
        - severities: tuple of severity ratings
        - base_score: base score as float
        - severity: base severity as string

    Raises:
        ValueError: If vector is invalid or version cannot be detected
    """
    version = detect_cvss_version(vector)

    if version is None:
        raise ValueError(f"Cannot detect CVSS version from vector: {vector}")

    try:
        if version == "v2":
            cvss = CVSS2(vector)
        elif version == "v3":
            cvss = CVSS3(vector)
        elif version == "v4":
            cvss = CVSS4(vector)
        else:
            raise ValueError(f"Unsupported CVSS version: {version}")

        scores = cvss.scores()
        severities = cvss.severities()

        return {
            "version": version,
            "vector": cvss.clean_vector(),
            "scores": scores,
            "severities": severities,
            "base_score": scores[0],
            "severity": severities[0],
        }
    except Exception as e:
        raise ValueError(f"Invalid CVSS vector: {e}") from e


def format_result(result: dict, as_json: bool = False) -> str:
    """Format calculation result for display."""
    if as_json:
        return json.dumps(
            {
                "version": result["version"],
                "vector": result["vector"],
                "base_score": result["base_score"],
                "severity": result["severity"],
                "all_scores": list(result["scores"]),
                "all_severities": list(result["severities"]),
            },
            indent=2,
        )

    lines = [
        f"CVSS Version: {result['version'].upper()}",
        f"Vector: {result['vector']}",
        f"Base Score: {result['base_score']} ({result['severity']})",
    ]

    if len(result["scores"]) > 1:
        score_names = ["Base", "Temporal", "Environmental"]
        for i, (score, severity) in enumerate(
            zip(result["scores"], result["severities"])
        ):
            if i > 0:
                lines.append(f"{score_names[i]} Score: {score} ({severity})")

    return "\n".join(lines)


def interactive_mode():
    """Run calculator in interactive mode."""
    print("CVSS Score Calculator - Interactive Mode")
    print("Supports CVSS v2, v3.0, v3.1, and v4.0")
    print("Enter 'quit' or 'q' to exit\n")

    while True:
        try:
            vector = input("Enter CVSS vector: ").strip()

            if vector.lower() in ("quit", "q", "exit"):
                print("Exiting...")
                break

            if not vector:
                continue

            result = calculate_cvss_score(vector)
            print("\n" + format_result(result) + "\n")

        except ValueError as e:
            print(f"Error: {e}\n", file=sys.stderr)
        except (KeyboardInterrupt, EOFError):
            print("\nExiting...")
            break


def process_file(filepath: str, as_json: bool = False) -> list:
    """Process vectors from a file, one per line."""
    results = []

    with open(filepath, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()

            if not line or line.startswith("#"):
                continue

            try:
                result = calculate_cvss_score(line)
                result["line"] = line_num
                results.append(result)
            except ValueError as e:
                results.append(
                    {
                        "line": line_num,
                        "vector": line,
                        "error": str(e),
                    }
                )

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Calculate CVSS scores from vector strings (supports v2, v3.x, v4.0)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
  %(prog)s --interactive
  %(prog)s --file vectors.txt --json
  %(prog)s "AV:N/AC:L/Au:N/C:C/I:C/A:C"  # CVSS v2
  %(prog)s "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"
        """,
    )

    parser.add_argument("vector", nargs="?", help="CVSS vector string to calculate")

    parser.add_argument(
        "-i", "--interactive", action="store_true", help="Run in interactive mode"
    )

    parser.add_argument(
        "-f", "--file", metavar="FILE", help="Read vectors from file (one per line)"
    )

    parser.add_argument(
        "-j", "--json", action="store_true", help="Output results as JSON"
    )

    parser.add_argument("-v", "--version", action="version", version="%(prog)s 1.0.0")

    args = parser.parse_args()

    if args.interactive:
        interactive_mode()
        return 0

    if args.file:
        try:
            results = process_file(args.file, args.json)

            if args.json:
                print(json.dumps(results, indent=2))
            else:
                for result in results:
                    if "error" in result:
                        print(
                            f"Line {result['line']}: Error - {result['error']}",
                            file=sys.stderr,
                        )
                    else:
                        print(f"--- Line {result['line']} ---")
                        print(format_result(result))
                        print()

            errors = sum(1 for r in results if "error" in r)
            return 1 if errors > 0 else 0

        except FileNotFoundError:
            print(f"Error: File not found: {args.file}", file=sys.stderr)
            return 1
        except Exception as e:
            print(f"Error reading file: {e}", file=sys.stderr)
            return 1

    if args.vector:
        try:
            result = calculate_cvss_score(args.vector)
            print(format_result(result, args.json))
            return 0
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
