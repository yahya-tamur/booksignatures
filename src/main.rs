use clap::Parser;
use lopdf::Document;
use regex::Regex;
use std::process::Command;

///Arranges pages of a pdf to print in signatures
#[derive(Parser, Debug)]
#[command( about, long_about = None)]
struct Args {
    input: String,
    output: String,

    ///number of pages in a stack you want to fold in half.
    #[arg(short, long, default_value_t = 3)]
    signatures: usize,

    ///number of blank pages to add to the start
    #[arg(short, long, default_value_t = 2)]
    pad_start: usize,

    ///remove intermediate files at the end
    #[arg(short, long, default_value_t = false)]
    clean: bool,
}

fn main() {
    let args = Args::parse();

    //Get pagesize and pagenum
    let pdf_data_cmd = Command::new("pdftk")
        .arg(&args.input)
        .arg("dump_data")
        .output()
        .unwrap();

    assert!(
        pdf_data_cmd.status.success(),
        "couldn't get pdf info from input"
    );

    let pdf_data = String::from_utf8(pdf_data_cmd.stdout).unwrap();

    let pagesize_re = Regex::new(r"(?s)^.*?PageMediaDimensions: (?P<w>\d+) (?P<h>\d+).*$").unwrap();
    let pagesize: &str = &pagesize_re.replace(&pdf_data, "${w}x$h");

    let pagenum_re = Regex::new(r"NumberOfPages: (?P<n>\d+)").unwrap();
    let pagenum: usize = pagenum_re
        .captures(&pdf_data)
        .unwrap()
        .name("n")
        .unwrap()
        .as_str()
        .parse::<usize>()
        .unwrap();

    println!("number of pages: {pagenum}, pagesize: {pagesize}");

    //add blank pages.
    println!("adding blank pages");
    let stack_size = args.signatures * 4;
    let pad_end = match (pagenum + args.pad_start) % stack_size {
        0 => 0,
        rem => stack_size - rem,
    };

    Command::new("convert")
        .arg("xc:none")
        .arg("-page")
        .arg(pagesize)
        .arg("blankpage.pdf")
        .output()
        .unwrap();

    Command::new("pdftk")
        .arg(format!("A={}", &args.input))
        .arg("B=blankpage.pdf")
        .arg("cat")
        .args(vec!["B1"; args.pad_start])
        .arg("A1-end")
        .args(vec!["B1"; pad_end])
        .arg("output")
        .arg("stage1.pdf")
        .output()
        .unwrap();

    println!("reordering pages");
    //reorder pages
    let mut doc = Document::load("stage1.pdf").unwrap();

    for start in (0..(pagenum + args.pad_start + pad_end)).step_by(stack_size) {
        println!("page: {start}");
        let pagerefs = (start..)
            .take(stack_size)
            .map(|i| *doc.get_pages().get(&((i + 1) as u32)).unwrap())
            .collect::<Vec<lopdf::ObjectId>>();
        let pages = doc
            .page_iter()
            .skip(start)
            .take(stack_size)
            .map(|pageref| doc.get_object(pageref).unwrap().clone())
            .collect::<Vec<lopdf::Object>>();
        for i in 0..args.signatures {
            doc.set_object(pagerefs[4 * i], pages[stack_size - 1 - 2 * i].clone());
            doc.set_object(pagerefs[1 + 4 * i], pages[0 + 2 * i].clone());
            doc.set_object(pagerefs[2 + 4 * i], pages[1 + 2 * i].clone());
            doc.set_object(pagerefs[3 + 4 * i], pages[stack_size - 2 - 2 * i].clone());
        }
    }
    println!("saving");
    doc.save("stage2.pdf").unwrap();

    //put pairs of pages side by side
    println!("combining pages");
    Command::new("pdfjam")
        .arg("--nup")
        .arg("2x1")
        .arg("--twoside")
        .arg("--landscape")
        .arg("stage2.pdf")
        .arg("-o")
        .arg(&args.output)
        .output()
        .unwrap();

    //delete intermediate files if requested.
    if args.clean {
        println!("deleting intermediate files");
        Command::new("rm")
            .arg("blankpage.pdf")
            .arg("stage1.pdf")
            .arg("stage2.pdf")
            .output()
            .unwrap();
    }

    println!("finished!");
}
