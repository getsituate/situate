use std::{fs, io::Write, path::Path};

pub(super) fn seed(folder: &Path) -> std::io::Result<()> {
    fs::create_dir(folder)?;
    for (name, bytes) in [
        (
            "Volunteer welcome pack.pdf",
            pdf(&[
                &[
                    "Volunteer welcome pack",
                    "Spring open day",
                    "25 April | 10:00-13:00",
                    "Meet at the garden gate at 09:30.",
                ],
                &[
                    "Welcome table checklist",
                    "Maps and signs",
                    "Blank envelopes and pencils",
                    "Seed trays and a folding table",
                ],
            ]),
        ),
        (
            "Seed swap receipt.pdf",
            pdf(&[&[
                "Seed swap receipt",
                "RECEIPT GS-2048",
                "Seed envelopes     12.00",
                "Plant labels        8.50",
                "Total              20.50",
            ]]),
        ),
        (
            "Garden bed map.png",
            include_bytes!("garden-bed-map.png").to_vec(),
        ),
    ] {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(folder.join(name))?
            .write_all(&bytes)?;
    }
    Ok(())
}

fn pdf(pages: &[&[&str]]) -> Vec<u8> {
    let kids = (0..pages.len())
        .map(|index| format!("{} 0 R", 4 + 2 * index))
        .collect::<Vec<_>>()
        .join(" ");
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        format!("<< /Type /Pages /Kids [{kids}] /Count {} >>", pages.len()),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
    ];
    for (index, lines) in pages.iter().enumerate() {
        let contents = 5 + 2 * index;
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 540 756] /Resources << /Font << /F1 3 0 R >> >> /Contents {contents} 0 R >>"));
        let stream = lines
            .iter()
            .enumerate()
            .map(|(line, text)| {
                let size = if line == 0 { 24 } else { 14 };
                let y = 678 - 38 * line;
                format!("BT /F1 {size} Tf 54 {y} Td ({text}) Tj ET\n")
            })
            .collect::<String>();
        objects.push(format!(
            "<< /Length {} >>\nstream\n{stream}endstream",
            stream.len()
        ));
    }
    let mut file = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(file.len());
        writeln!(&mut file, "{} 0 obj\n{object}\nendobj", index + 1).unwrap();
    }
    let xref = file.len();
    write!(
        &mut file,
        "xref\n0 {}\n0000000000 65535 f \n",
        offsets.len() + 1
    )
    .unwrap();
    for offset in offsets {
        writeln!(&mut file, "{offset:010} 00000 n ").unwrap();
    }
    write!(
        &mut file,
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
        objects.len() + 1
    )
    .unwrap();
    file
}
