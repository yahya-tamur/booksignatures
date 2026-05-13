use clap::Parser;
use lopdf::Document;
use pdfcrop::{crop_pdf, BoundingBox, CropOptions, Margins};
use regex::Regex;
use std::process::Command;

/// Arranges pages of a pdf to print in signatures
#[derive(Parser, Debug)]
#[command( about, long_about = None)]
struct Args {
    input: String,
    output: String,

    /// top, bottom, left, right margin adjustment (positive or negative)
    /// before combining pages.
    #[arg(short, long, default_values_t = vec![0., 0., 0., 0.], value_delimiter = ' ', num_args = 4, allow_hyphen_values=true)]
    margin_pre: Vec<f64>,

    /// top, bottom, left, right margin adjustment (positive or negative)
    /// after combining pages.
    #[arg(long, default_values_t = vec![0., 0., 0., 0.], value_delimiter = ' ', num_args = 4, allow_hyphen_values=true)]
    margin_post: Vec<f64>,

    /// number of pages per signature.
    #[arg(short, long, default_value_t = 3)]
    signatures: usize,

    /// number of blank pages at the start
    #[arg(short, long, default_value_t = 2)]
    pad_start: usize,

    /// remove intermediate files at the end
    #[arg(short, long, default_value_t = false)]
    clean: bool,
}

struct Stage {
    stages: Vec<String>,
    pub width: f64,
    pub height: f64,
    pub pagenum: usize,
}

impl Stage {
    fn new_stage(&mut self) {
        self.stages.push(format!("stage{}.pdf", self.stages.len()))
    }

    fn pre(&self) -> &str {
        &self.stages[self.stages.len() - 2]
    }

    fn post(&self) -> &str {
        &self.stages[self.stages.len() - 1]
    }

    fn new(input: &str) -> Stage {
        //Get pagesize and pagenum
        println!("analyzing pdf.");
        let pdf_data_cmd = Command::new("pdftk")
            .arg(input)
            .arg("dump_data")
            .output()
            .unwrap();

        assert!(
            pdf_data_cmd.status.success(),
            "couldn't get pdf info from input"
        );

        let pdf_data = String::from_utf8(pdf_data_cmd.stdout).unwrap();

        let pagesize_re =
            Regex::new(r"(?s)^.*?PageMediaDimensions: (?P<w>\d+) (?P<h>\d+).*$").unwrap();
        let pagesize_caps = pagesize_re.captures(&pdf_data).unwrap();
        let width = pagesize_caps[1].parse::<f64>().unwrap();
        let height = pagesize_caps[2].parse::<f64>().unwrap();

        let pagenum_re = Regex::new(r"NumberOfPages: (?P<n>\d+)").unwrap();
        let pagenum_caps = pagenum_re.captures(&pdf_data).unwrap();

        let pagenum = pagenum_caps[1].parse::<usize>().unwrap();

        println!("number of pages: {pagenum}, width: {width}, height: {height}");

        Stage {
            stages: vec![input.to_string()],
            width,
            height,
            pagenum,
        }
    }

    fn apply_margin(&mut self, msg: &str, t: f64, b: f64, l: f64, r: f64) {
        let (tt, bb, ll, rr) = (t.max(0.), b.max(0.), l.max(0.), r.max(0.));

        if tt > 0. || bb > 0. || ll > 0. || rr > 0. {
            println!("{}: extending", msg);

            self.new_stage();

            let mut cmd = Command::new("pdfjam");

            cmd.arg("--papersize")
                .arg(format!(
                    "{},{}",
                    ll + self.width + rr,
                    tt + self.height + bb
                ))
                .arg("--offset")
                .arg(format!("{} {}", (ll - rr) / 2., (bb - tt) / 2.)) //bottom??
                .arg(self.pre())
                .arg("-o")
                .arg(self.post());
            cmd.output().unwrap();
            self.width += ll + rr;
            self.height += tt + bb;
        }
        println!("{} {} {} {}", tt, bb, ll, rr);
        let (tt, bb, ll, rr) = (t.min(0.), b.min(0.), l.min(0.), r.min(0.));

        if tt < 0. || bb < 0. || ll < 0. || rr < 0. {
            println!("{}: shrinking", msg);

            self.new_stage();

            let pdf_data = std::fs::read(self.pre()).unwrap();

            println!(
                "{} {} | {} {} {} {}",
                self.width, self.height, tt, bb, ll, rr
            );
            let options = CropOptions {
                margins: Margins::none(),
                bbox_override: Some(
                    BoundingBox::new(0. - ll, 0. - bb, self.width + rr, self.height + tt).unwrap(),
                ),
                ..Default::default()
            };

            let cropped = crop_pdf(&pdf_data, options).unwrap();
            std::fs::write(self.post(), cropped).unwrap();
            self.width += ll + rr;
            self.height += tt + bb;
        }
    }
    fn make_signatures(&mut self, signatures: usize, pad_start: usize) {
        let stack_size = signatures * 4;
        let pad_end = match (self.pagenum + pad_start) % stack_size {
            0 => 0,
            rem => stack_size - rem,
        };

        println!("adding blank pages");
        self.new_stage();
        Command::new("convert")
            .arg("xc:none")
            .arg("-page")
            .arg(format!("{}x{}", self.width, self.height))
            .arg(self.post())
            .output()
            .unwrap();

        let pre = self.pre().to_string();
        self.new_stage();
        Command::new("pdftk")
            .arg(format!("A={}", pre))
            .arg(format!("B={}", self.pre()))
            .arg("cat")
            .args(vec!["B1"; pad_start])
            .arg("A1-end")
            .args(vec!["B1"; pad_end])
            .arg("output")
            .arg(self.post())
            .output()
            .unwrap();

        //reorder pages
        println!("reordering pages");
        self.new_stage();

        let mut doc = Document::load(self.pre()).unwrap();

        for start in (0..(self.pagenum + pad_start + pad_end)).step_by(stack_size) {
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
            for i in 0..signatures {
                doc.set_object(pagerefs[4 * i], pages[stack_size - 1 - 2 * i].clone());
                doc.set_object(pagerefs[1 + 4 * i], pages[2 * i].clone());
                doc.set_object(pagerefs[2 + 4 * i], pages[1 + 2 * i].clone());
                doc.set_object(pagerefs[3 + 4 * i], pages[stack_size - 2 - 2 * i].clone());
            }
        }
        doc.save(self.post()).unwrap();
    }

    fn combine2x1(&mut self) {
        println!("combining pages");
        self.new_stage();
        self.width += self.width;
        Command::new("pdfjam")
            .arg("--papersize")
            .arg(format!("{},{}", self.width, self.height))
            .arg("--nup")
            .arg("2x1")
            .arg("--twoside")
            .arg(self.pre())
            .arg("-o")
            .arg(self.post())
            .output()
            .unwrap();
    }

    fn finalize(&self, output: &str, clean: bool) {
        println!("renaming output");
        Command::new("mv")
            .arg(self.post())
            .arg(output)
            .output()
            .unwrap();

        if clean {
            println!("deleting intermediate files");
            Command::new("rm")
                .arg("-f")
                .args(&self.stages[1..self.stages.len() - 1])
                .output()
                .unwrap();
        }

        println!("finished!");
    }
}

fn main() {
    let args = Args::parse();
    let mut stage = Stage::new(&args.input);

    stage.make_signatures(args.signatures, args.pad_start);

    if args.margin_pre != vec![0., 0., 0., 0.] {
        stage.apply_margin(
            "pre-margins",
            args.margin_pre[0],
            args.margin_pre[1],
            args.margin_pre[2],
            args.margin_pre[3],
        );
    }

    stage.combine2x1();

    if args.margin_post != vec![0., 0., 0., 0.] {
        stage.apply_margin(
            "post-margins",
            args.margin_post[0],
            args.margin_post[1],
            args.margin_post[2],
            args.margin_post[3],
        );
    }

    stage.finalize(&args.output, args.clean);
}
