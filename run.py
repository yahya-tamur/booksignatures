import os
os.system("""
cargo run -- \
    stable.pdf \
    stable_s.pdf \
    --margin-pre 0 0 -30 -30 \
    --margin-post 0 0 60 60 \
    --signatures 9 \
    --pad-start 4 \
    --clean \
""")