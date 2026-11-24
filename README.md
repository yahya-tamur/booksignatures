-----
Update: I used AI to make a version that works in the browser:

[https://yahya-tamur.github.io/booksignatures/](https://yahya-tamur.github.io/booksignatures/)

This has fewer features than many other similar programs, but should be pretty good at what
it does, especially at detecting and setting margins.

Consider using this one as well:

[https://momijizukamori.github.io/bookbinder-js/](https://momijizukamori.github.io/bookbinder-js/)

-----

This program creates signatures to prepare to print a pdf to create sewn book.

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
