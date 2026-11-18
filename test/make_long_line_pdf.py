"""Test PDF for "Detect margins": 20 Letter pages of justified text with 1 inch
margins (the last page short), except one line on page 7 that runs past the
right margin and off the edge of the page.

    python3 test/make_long_line_pdf.py   # writes test/one_long_line.pdf
"""
import os
import random

import pymupdf

random.seed(1)
words = ("the of signature fold paper sheet book binding thread needle spine margin gutter page "
         "press glue board cover stitch kettle linen awl bone folder cradle text block").split()
doc = pymupdf.open()
for n in range(1, 21):
    p = doc.new_page(width=612, height=792)
    body = pymupdf.Rect(72, 72, 540, 720)
    count = 900 if n != 20 else 200
    while True:      # as many words as fit (insert_textbox inserts nothing on overflow)
        text = " ".join(random.choice(words) for _ in range(count))
        shape = p.new_shape()
        if shape.insert_textbox(body, text, fontsize=11, fontname="tiro",
                                align=pymupdf.TEXT_ALIGN_JUSTIFY) >= 0:
            shape.commit()
            break
        count -= 5
    if n == 7:
        p.draw_rect(pymupdf.Rect(70, 300, 542, 316), color=None, fill=(1, 1, 1))
        p.insert_text((72, 312), "This one line is far too long: it starts at the left margin and keeps "
                      "going past the right margin and off the edge of the page entirely.",
                      fontsize=11, fontname="tiro")
doc.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "one_long_line.pdf"))
