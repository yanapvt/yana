# Repository secret remediation

The safe audit identifies `config/yana-tts.json` as a tracked and historical
private-key-shaped file, first observed in commit `8a9c4337830c9825ccfe6403e7fc79db2fe60797`.
No secret value is reproduced here. Treat the credential as compromised until
the owning account confirms otherwise.

The history-only audit also flags `.ssh` in commit
`89deae33ef7a2aebce5b4f969d6aae99c2b2a7e4`. Its owning key must be identified
and rotated before authorized history cleanup; the audit intentionally does not
print its former contents.

Required authorized response: revoke/rotate the external credential, replace the
runtime value with a secret-manager reference, remove the file from the current
tree, and coordinate a history rewrite with every repository user and protected
branch owner. Invalidate old clones and CI caches afterward. Do not rewrite
history or claim rotation from this checkpoint; both require explicit authority
and external-account access.

Run `npm run security:audit`. It prints file paths and commit counts only, exits
non-zero while current tracked findings exist, and never prints matched values.
Known deployment examples containing repeated placeholder characters are reported
separately as templates rather than silently ignored.
