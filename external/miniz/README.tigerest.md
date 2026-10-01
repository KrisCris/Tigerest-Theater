# miniz 3.1.2

Unmodified amalgamated `miniz.c`, `miniz.h`, and `LICENSE` from the official
3.1.2 release attachment:
https://github.com/richgel999/miniz/releases/download/3.1.2/miniz-3.1.2.zip

Release tag commit: `77d0dce8627735138c51770d1799a1ef48f2117d`.
Archive SHA256: `f0446d863f9c19926ad9483c523fdc42e42b8d4a6a431d27e09d49c79a140d9a`.

Tigerest builds only the ZIP64 reader and inflater, without stdio APIs or
archive-writing/deflate APIs. All file I/O uses Qt callbacks for Unicode paths.
The MIT license is retained alongside the source and must accompany bundles.
