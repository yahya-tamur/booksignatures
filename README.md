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

https://github.com/yahya-tamur/booksignatures/blob/main/run.py#

```bash
python3 ./run.py
```
