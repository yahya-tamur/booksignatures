I wrote this short program in order to print a personal copy of EGA.

It takes a normal pdf, and puts two pages per side (four per piece of paper) so
you can arrange them stack them up in 'signatures', fold each in half, and then
stitch the folded halves together to create the inside of a book.

Essentially, if you have pages:
```
[--][--][--][--][--][--]
[--][--][--][--][--][--] ...
[-1][-2][-3][-4][-5][-6]
```
And you want stacks of size two, it creates the pages:
```
[----][----][----][----][----]
[----][----][----][----][----] ...
[-8-1][-2-7][-6-3][-4-5][15-9]
```
So the first stack of two (two sided) papers looks like:
```
 4   5 
------
3   6
 2   7
------
1   8
```
folded in half:
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

While printing, you should print two sided, flipping on the short edge.

Note that the last signature will not be any smaller, so you might end up
with a lot of blank pages at the end.

The command-line options can be viewed using the `--help` flag. If running using
cargo run, make sure to put all options after a `--`:
```
cargo run -- --help
```
```
cargo run -- input.pdf output.pdf --signatures 4 --pad-start 2 --clean
```
The program combines calls to several different command-line utilities as well
as a pdf library in rust to reorder the pages. You might get some errors and
have to download some of them. I only tested on linux.
