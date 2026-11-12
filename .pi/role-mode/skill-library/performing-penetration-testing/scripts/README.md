# Scripts

Utility scripts for the penetration-tester skill.

## cvss_calculator.py

A CVSS (Common Vulnerability Scoring System) score calculator supporting versions 2.0, 3.x, and 4.0.

Uses the official Red Hat CVSS library which implements the FIRST.org CVSS specification.

### Dependency license

The separately installed `cvss` package is licensed under [LGPL-3.0-or-later](https://github.com/RedHatProductSecurity/cvss/blob/2f149099257ae06b98cef252efc440bddafe61e5/COPYRIGHT). It is not bundled with this script. Its license and source-availability obligations apply when redistributing the package; the script's MIT declaration does not relicense that dependency.

### Installation

```bash
pip install cvss
```

### Usage

#### Calculate score from vector string

```bash
# CVSS v3.1
python cvss_calculator.py "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"

# CVSS v4.0
python cvss_calculator.py "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"

# CVSS v2
python cvss_calculator.py "AV:N/AC:L/Au:N/C:C/I:C/A:C"
```

#### Interactive mode

```bash
python cvss_calculator.py --interactive
```

#### Batch processing

Create a file with one vector per line:

```text
CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N
# Comments are ignored
AV:L/AC:L/Au:N/C:P/I:P/A:P
```

Then run:

```bash
python cvss_calculator.py --file vectors.txt
```

#### JSON output

```bash
python cvss_calculator.py --json "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
```

### Sample Output

```
CVSS Version: V3
Vector: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
Base Score: 9.8 (Critical)
```

### References

- [CVSS v4.0 Specification](https://www.first.org/cvss/v4.0/specification-document)
- [CVSS v3.1 Specification](https://www.first.org/cvss/v3.1/specification-document)
- [Red Hat CVSS Library](https://github.com/RedHatProductSecurity/cvss)
- [FIRST.org CVSS Resources](https://github.com/FIRSTdotorg/cvss-resources)
