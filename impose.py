#!/usr/bin/env python3
"""Arrange the pages of a PDF into signatures, two pages per sheet side.

Uses only PyMuPDF. Pages are placed as vectors (no rasterizing), and all
coordinates are relative to each page's visible box, so PDFs whose MediaBox
or CropBox does not start at (0, 0) work.

Lengths are in PostScript points (1/72 inch).

Margins on the output:
    --gutter  space from the fold to the content, on each side of the fold
    --outer   space from the outer edge of the sheet to the content
    --top, --bottom
Without --paper, the sheet is sized to fit the pages at 100% scale plus those
margins. With --paper, the pages are scaled (one scale for the whole book) to
fit inside the margins and centred in the space left over.

--trim TOP BOTTOM INNER OUTER cuts that much off each source page first.
Inner/outer are mirrored: inner is the left edge of odd (right-hand) pages and
the right edge of even (left-hand) pages.
"""

import argparse
import sys

import pymupdf


def signature_order(n_pages, pad_start, sheets):
    """Page indices in printing order, two per sheet side; None is a blank page.

    Returns (order, pad_end). order[2*j], order[2*j+1] are the left and right
    halves of output page j.
    """
    stack = 4 * sheets
    pad_end = -(n_pages + pad_start) % stack
    padded = [None] * pad_start + list(range(n_pages)) + [None] * pad_end
    order = []
    for start in range(0, len(padded), stack):
        p = padded[start:start + stack]
        for i in range(sheets):
            order += [p[stack - 1 - 2 * i], p[2 * i],          # front: left, right
                      p[2 * i + 1], p[stack - 2 - 2 * i]]      # back:  left, right
    return order, pad_end


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("-s", "--sheets", type=int, default=3,
                    help="sheets of paper per signature (4 pages each)")
    ap.add_argument("-p", "--pad-start", type=int, default=0,
                    help="blank pages before the first page")
    ap.add_argument("--trim", type=float, nargs=4, default=[0, 0, 0, 0],
                    metavar=("TOP", "BOTTOM", "INNER", "OUTER"),
                    help="cut this much off each source page (mirrored inner/outer)")
    ap.add_argument("--gutter", type=float, default=0)
    ap.add_argument("--outer", type=float, default=0)
    ap.add_argument("--top", type=float, default=0)
    ap.add_argument("--bottom", type=float, default=0)
    ap.add_argument("--paper",
                    help="output sheet size, e.g. letter-l, a4-l, tabloid, "
                         "or WIDTHxHEIGHT in points")
    args = ap.parse_args()

    src = pymupdf.open(args.input)
    n = len(src)
    if n == 0:
        sys.exit("input has no pages")

    # show_pdf_page ignores /Rotate, so bake each page's rotation into its
    # content (in memory only). PyMuPDF 1.26 gets this wrong when the MediaBox
    # doesn't start at (0, 0); the web page (web/) handles that case.
    odd = 0
    for p in src:
        if p.rotation:
            if p.mediabox.x0 or p.mediabox.y0:
                odd += 1
            p.remove_rotation()
    if odd:
        print(f"warning: {odd} rotated pages have a MediaBox that doesn't start at "
              "(0, 0) and may be misplaced; use the web page instead", file=sys.stderr)

    # page.rect is the visible page (CropBox, rotation applied), origin top left.
    sizes = {(round(p.rect.width, 1), round(p.rect.height, 1)) for p in src}
    if len(sizes) > 1:
        print(f"warning: pages have different sizes {sorted(sizes)}; "
              "using the first page's size for layout", file=sys.stderr)
    pw, ph = src[0].rect.width, src[0].rect.height

    t, b, inner, outer_trim = args.trim
    cw, ch = pw - inner - outer_trim, ph - t - b          # content size per page
    if cw <= 0 or ch <= 0:
        sys.exit("--trim removes the whole page")

    if args.paper:
        if "x" in args.paper:
            W, H = (float(v) for v in args.paper.split("x"))
        else:
            W, H = pymupdf.paper_size(args.paper)
            if W < 0:
                sys.exit(f"unknown paper size {args.paper!r}")
        avail_w = W / 2 - args.gutter - args.outer
        avail_h = H - args.top - args.bottom
        if avail_w <= 0 or avail_h <= 0:
            sys.exit("margins leave no room on the paper")
        scale = min(avail_w / cw, avail_h / ch)
    else:
        scale = 1.0
        W = 2 * (args.outer + cw + args.gutter)
        H = args.top + ch + args.bottom
    sw, sh = cw * scale, ch * scale                       # placed size

    order, pad_end = signature_order(n, args.pad_start, args.sheets)
    n_sig = len(order) // (4 * args.sheets)
    print(f"{n} pages, {pw:.1f} x {ph:.1f} pt; {n_sig} signatures of "
          f"{args.sheets} sheets; blank pages: {args.pad_start} at start, "
          f"{pad_end} at end; sheet {W:.1f} x {H:.1f} pt, scale {scale:.3f}")

    # Centre the content block in the space inside the margins.
    y0 = args.top + (H - args.top - args.bottom - sh) / 2
    half_free = W / 2 - args.gutter - args.outer - sw
    left_x0 = args.outer + half_free / 2
    right_x0 = W / 2 + args.gutter + half_free / 2

    out = pymupdf.open()
    for j in range(0, len(order), 2):
        sheet = out.new_page(width=W, height=H)
        for pno, x0, recto in ((order[j], left_x0, False), (order[j + 1], right_x0, True)):
            if pno is None:
                continue
            r = src[pno].rect
            # Inner edge is on the left for right-hand pages, on the right for left-hand ones.
            l_trim, r_trim = (inner, outer_trim) if recto else (outer_trim, inner)
            clip = pymupdf.Rect(r.x0 + l_trim, r.y0 + t, r.x1 - r_trim, r.y1 - b)
            target = pymupdf.Rect(x0, y0, x0 + sw, y0 + sh)
            sheet.show_pdf_page(target, src, pno, clip=clip, keep_proportion=True)

    out.save(args.output, garbage=3, deflate=True)
    print(f"wrote {args.output}: {len(out)} pages")


if __name__ == "__main__":
    main()
