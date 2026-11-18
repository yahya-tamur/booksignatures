import os

# PyMuPDF version (see README):
os.system("""
python3 impose.py \
    stable.pdf \
    stable_s.pdf \
    --sheets 9 \
    --pad-start 4 \
    --trim 0 0 30 30 \
    --outer 60 \
""")

# Rust version:
# os.system("""
# cargo run -- \
#     stable.pdf \
#     stable_s.pdf \
#     --margin-pre 0 0 -30 -30 \
#     --margin-post 0 0 60 60 \
#     --signatures 9 \
#     --pad-start 4 \
#     --clean \
# """)
