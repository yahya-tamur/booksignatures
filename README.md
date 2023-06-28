I wrote this short program in order to print a personal copy of EGA. Here's how it turned out:

![](ega-images/1.jpg) | ![](ega-images/2.jpg)
|---|----|
![](ega-images/3.jpg) | ![](ega-images/4.jpg)

There are a few issues -- you can see the bottom stitch got cut off when I was trimming the edges,
the cover's pretty messy. The thread I used to stitch was too thick, so the stitched side is thicker than the
stack of pages, which leads to more issues. Also EGA's Numdam scan apparently has a few pages slid off center a bit so
some margins are very close to the edge of the paper. My second attempt with Ravi Vakil's Rising Sea
algebraic geometry notes (parts I and II) turned out a lot better. I'm hoping they'll hold up well over time.

The program itself takes a normal pdf, and rearranges the pages and puts two per side (four per piece of paper) so
you can stack them up in 'signatures', fold each signature in in half, and then
stitch the signatures together to create the inside of a book.

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
So the first stack of two (two sided) papers looks like this from the side:
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

While printing, you should print two sided, makeing sure to flip on the correct edge.

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
