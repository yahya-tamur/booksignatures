There are many other pdf editing programs with the capability of creating signatures.
Consider using this one:

[https://momijizukamori.github.io/bookbinder-js/](https://momijizukamori.github.io/bookbinder-js/)


This program creates signatures to prepare to print a pdf to create sewn book.
This process is described in the next section.

It can adjust margins before and after converting to signatures. Unlike some other
programs, all margins are offsets from the border, not the content, 
and can be positive or negative. The units are some combination of bp and pt. The
difference might not matter (1bp = 1.00374pt).

All pages of the input should be the same size.

On Ubuntu, the following packages are required. I have not tested on other
distributions or operating systems.

`sudo apt install pdftk-java imagemagick texlive-extra-utils`

------


In order to create a sewn book, you need to make stacks of double pages,
fold them in half together, and sew these 'signatures' together.

If you the following pdf,
```
[--] [--] [--] [--] [--] [--]
[--] [--] [--] [--] [--] [--] ...
[-1] [-2] [-3] [-4] [-5] [-6]
```
And you want signatures with two pages each, the program creates this pdf:
```
[----] [----] [----] [----] [----]
[----] [----] [----] [----] [----] ...
[-8-1] [-2-7] [-6-3] [-4-5] [15-9]
```
So the first signature looks like this from the side, before being folded:
```
 8   1 
------
7   2

 6   3
------
5   4
```
After being folded:
```
       1
  ------
  | 2
  |     3
  | ------
  | | 4
  | |   5
  | ------
  |  6
  |     7
  -------
    8
```

You may have to flip on the long edge or the short edge while printing.

There will be empty pages at the end calculated based on the number of empty pages
in the beginning and the number of pages per signature. Consider adjusting
the number of pages per signature to avoid having a lot of blank pages at the end.

The command-line options can be viewed using the `--help` flag.
```
cargo run -- --help
```

Since you may have to adjust the options a few times, I recommend editing the
included python file and running that.

https://github.com/yahya-tamur/booksignatures/blob/880afc847e39a98e7384c0dd3bdac90bf467544c/run.py#L1-L11

```bash
python3 ./run.py
```

------

## Web page (`web/`)

Live at https://yahya-tamur.github.io/booksignatures/

`web/` is a static web page that does the arrangement in the browser:

1. **Paper**: units and sheet size.
2. **PDF**: choose a file. It is read in the browser and never uploaded.
3. **Signatures**: the page count is rounded up to a multiple of 4; −4/+4
   change it. The added blank pages are split between the start and the end
   (adjustable). The table lists every way to split that many pages into equal
   signatures (the divisors of pages / 4).
4. **Trim**: cut off the PDF's own margins, by hand or with **Detect
   margins**, which renders every page small and finds where the ink is. It
   gives trims that cut nothing, and larger recommended ones when only a few
   lines (at most 3) on a few pages (at most 3%, or 2) stick out past them;
   those pages are listed. Lines that stick out can run into the margin, up to
   the paper edge, or the fold on the inner side.
5. **Margins**: gutter, outer, top and bottom space on the sheet. Pages are
   scaled to fit (or placed at 100% with "Pages at 100%").

The files: `index.html` and `style.css` (the page), `app.js` (the controls),
`core.js` (the layout and margin detection, also usable from Node). It uses two
JavaScript libraries, loaded from public CDNs: [pdf-lib](https://pdf-lib.js.org/)
to build the new PDF and [pdf.js](https://mozilla.github.io/pdf.js/) to render
pages for margin detection.

Run it locally:

```bash
python3 -m http.server -d web -b 127.0.0.1 8017
```

then open http://127.0.0.1:8017/. Every push to main that changes `web/` publishes
it to GitHub Pages (`.github/workflows/pages.yml`).

`test/make_long_line_pdf.py` makes a test PDF with 1 inch margins and one line
that runs off the edge of page 7.

------

## PyMuPDF version (`impose.py`)

`impose.py` does the same arrangement with a single Python library,
[PyMuPDF](https://pymupdf.readthedocs.io/), instead of pdftk, pdfjam,
ImageMagick, lopdf and pdfcrop:

```bash
sudo apt install python3-pymupdf
python3 impose.py --help
```

Differences from the Rust program:

- Pages are measured and placed relative to each page's visible box (CropBox,
  with rotation applied), so PDFs whose page box doesn't start at (0, 0), or
  that already have a CropBox, come out in the right place. Page sizes with
  decimals (A4) work.
- Pages stay vector graphics; they are placed, not rasterized.
- Margins are book margins instead of offsets:
  - `--trim TOP BOTTOM INNER OUTER` cuts that much off each source page.
    Inner/outer are mirrored between left and right pages.
  - `--gutter`, `--outer`, `--top`, `--bottom` set the space between the
    content and the fold, outer edge, top and bottom of the output sheet.
  - Without `--paper`, the sheet is sized to fit the pages at 100%. With
    `--paper letter-l` (or `a4-l`, `WIDTHxHEIGHT`, ...), all pages are scaled
    by one factor to fit inside the margins.
- `-s/--sheets` is the number of sheets per signature (called `--signatures`
  in the Rust program).
- Rotated pages (`/Rotate`) are shown the way PDF viewers show them. PyMuPDF
  1.26 misplaces rotated pages whose MediaBox doesn't start at (0, 0); the
  script warns about those, and the web page handles them correctly.

The old `--margin-pre 0 0 -30 -30 --margin-post 0 0 60 60` is
`--trim 0 0 30 30 --outer 60`.
