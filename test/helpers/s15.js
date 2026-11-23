// Shared by the S15 tests (#486): this tree's root and the CPython the S15 goldens were recorded from.
// The recorder (s15-record.py), the recorded-CPython lookup and the base-revision lookup of
// clipboard_guard.py were deleted by #502 (S32 of #470, one Node runtime): the goldens are frozen.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CPYTHON = '3.14.6';
