# Bash Anti-Patterns

Common mistakes and what to do instead. Based on
[Wooledge BashPitfalls](https://mywiki.wooledge.org/BashPitfalls) and practical experience.

## 1. Parsing `ls` Output

```bash
# BAD — breaks on spaces, newlines, special chars in filenames
for f in $(ls *.mp3); do
  echo "$f"
done

# GOOD — use globs directly
for f in *.mp3; do
  [[ -e "$f" ]] || continue  # handle no-match case
  echo "$f"
done
```

## 2. Unquoted Variables

```bash
# BAD — word splitting + globbing
cp $file $target
rm -rf $DIR/*

# GOOD
cp "$file" "$target"
rm -rf "${DIR}"/*
```

This applies everywhere: `echo $var`, `[ $var = x ]`, function arguments, etc.

## 3. `cd` Without Error Check

```bash
# BAD — if cd fails, rm runs in the wrong directory
cd /some/path
rm -rf *

# GOOD
cd /some/path || exit 1
rm -rf *
```

## 4. `for f in $(command)` — Word Splitting Trap

```bash
# BAD — splits on spaces, not just newlines
for line in $(cat file.txt); do
  echo "$line"
done

# GOOD — read line by line
while IFS= read -r line; do
  echo "$line"
done < file.txt
```

## 5. Pipe Into While Loop (Subshell Problem)

Variables set inside a piped while loop are lost — the loop runs in a subshell.

```bash
# BAD — count is always 0 after the loop
count=0
cat file.txt | while IFS= read -r line; do
  ((count++))
done
echo "$count"  # prints 0

# GOOD — use process substitution (Bash-specific)
count=0
while IFS= read -r line; do
  ((count++))
done < <(cat file.txt)
echo "$count"  # correct

# GOOD — redirect from file directly
count=0
while IFS= read -r line; do
  ((count++))
done < file.txt
echo "$count"
```

## 6. Using `eval`

```bash
# BAD — arbitrary code execution risk
eval "$user_input"
eval "cmd='$variable'"

# GOOD — use arrays for dynamic commands
cmd=("docker" "run" "--rm" "$image")
"${cmd[@]}"
```

Never `eval` user-controlled input. If truly needed, validate and sanitize rigorously.

## 7. `[ ]` Instead of `[[ ]]`

```bash
# BAD — vulnerable to word splitting, no pattern matching
[ $var = "hello" ]
[ -z $var ]

# GOOD — Bash builtin, safe without quoting on left side
[[ $var == "hello" ]]
[[ -z $var ]]
```

`[[ ]]` supports `&&`, `||`, pattern matching (`==` with globs), and regex (`=~`).

## 8. Unquoted `$@`

```bash
# BAD — arguments with spaces are split
my_wrapper() { some_command $@; }

# GOOD — preserves argument boundaries
my_wrapper() { some_command "$@"; }
```

`"$@"` expands each positional parameter as a separate quoted word.
`"$*"` joins all parameters into a single string (rarely what you want).

## 9. `cat file | command` (Useless Use of Cat)

```bash
# BAD — unnecessary process
cat file.txt | grep "pattern"

# GOOD — direct redirect
grep "pattern" file.txt

# GOOD — when piping between commands is actually needed
cmd1 | cmd2
```

## 10. Missing `--` Before User-Supplied Arguments

Filenames starting with `-` are interpreted as options.

```bash
# BAD — breaks on files like "-rf" or "--help"
rm $file
grep $pattern file

# GOOD — double dash ends option parsing
rm -- "$file"
grep -- "$pattern" file
```

## 11. Not Handling Empty Globs

When `set -e` is active and a glob matches nothing, it expands to the literal glob string.

```bash
# BAD — iterates over literal "*.mp3" if no files match
for f in *.mp3; do
  process "$f"
done

# GOOD — check existence or use nullglob
shopt -s nullglob
for f in *.mp3; do
  process "$f"
done
shopt -u nullglob

# GOOD — alternative: guard each iteration
for f in *.mp3; do
  [[ -e "$f" ]] || continue
  process "$f"
done
```

## 12. Numeric Comparison with `==` Instead of `-eq`

```bash
# BAD inside [ ] — string comparison, not numeric
[ "$count" == "5" ]

# GOOD — numeric comparison
[[ "$count" -eq 5 ]]
# or arithmetic
(( count == 5 ))
```

Inside `[[ ]]`, `==` does string/pattern matching. Use `-eq`, `-lt`, `-gt` for numbers,
or use `(( ))` arithmetic evaluation.

## 13. Forgetting That `local` Assignment Masks Return Code

```bash
# BAD — local always returns 0, masking the error
my_func() {
  local output=$(failing_command)  # exit code lost!
}

# GOOD — separate declaration from assignment
my_func() {
  local output
  output=$(failing_command)  # exit code preserved under set -e
}
```

## 14. Separating `local -r` Declaration from Assignment

```bash
# BAD — readonly declaration, then assignment fails
my_func() {
  local -r filename        # declares readonly variable with empty value
  filename="$(basename "$1")"  # ERROR: readonly variable
}

# GOOD — combine declaration and assignment on same line
my_func() {
  local -r filename="$(basename "$1")"
}

# GOOD — if you need error checking, use two steps without -r
my_func() {
  local filename
  filename="$(failing_command)" || return 1
  readonly filename  # make readonly after successful assignment
}
```

When using `local -r` (readonly local), the declaration and assignment MUST be on the same line.
`local -r var` creates an empty readonly variable — any subsequent assignment fails.

## 15. Using `echo` for Arbitrary Data

```bash
# BAD — echo interprets escape sequences, -n/-e flags vary across systems
echo "$user_data"

# GOOD — printf is portable and predictable
printf '%s\n' "$user_data"
```

## 16. Backticks Instead of `$()`

```bash
# BAD — hard to nest, hard to read
result=`command1 \`command2\``

# GOOD — nests cleanly
result=$(command1 $(command2))
```

## 17. Not Using `set -euo pipefail`

Without strict mode, scripts silently continue after errors. A failed `cp`, broken pipe,
or typo in a variable name produces no visible error. Always start scripts with:

```bash
set -euo pipefail
```

## 18. Sourcing Files Without Path Validation

```bash
# BAD — sources whatever is on $PATH or current directory
source config.sh

# GOOD — use absolute/relative path from script directory
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"
```

## 19. String Comparison Without Handling Empty Variables

```bash
# BAD under set -u — errors if $1 is unset
if [[ $1 == "start" ]]; then ...

# GOOD — default value
if [[ "${1:-}" == "start" ]]; then ...
```
