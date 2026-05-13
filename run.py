import os
os.system("""
cargo run -- \
    stable.pdf \
    stable_s.pdf \
    --margin-pre -100 -50 100 100 \
    --margin-post 0 00 400 00 \
    --signatures 9 \
    --pad-start 4 \
    --clean
""")