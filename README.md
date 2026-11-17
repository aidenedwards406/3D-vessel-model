# 3D Vessel Model

An interactive 3D viewer for presenting blood vessel mimic test results to industry partners. Each image of vessel damage is mapped to the place on the vessel where it was taken, and the model is colored as a heat map by damage level. Partners can explore the results on a 3D model instead of paging through folders of images.

## Project goals

1. **View a 3D vessel model in the browser**: rotate, zoom and pan.
2. **Load models from two sources**: a phone 3D scan, or an STL file supplied by the partner company.
3. **Divide the vessel into sections**: the user sets how many sections the vessel was cut into (usually 4 or 6).
4. **Map images automatically**: images are placed on the model by reading our existing file names (section, top/bottom, and position along the section).
5. **Click to inspect**: clicking a location opens the image or set of images taken there.
6. **Damage heat map**: upload the Excel sheet of percent damage per image, and the model is colored by damage level.
7. **Compare treatments**: switch between vessels (bioreactors) to compare controls, the partner's new device, and market-standard devices.
8. **Keep data confidential**: partner data stays on the user's computer and is never uploaded or stored by the app.
9. **Save and reopen studies**: save a study's full setup as one file and reopen it later without setting it up again.
10. **Presentation mode**: a clean, distraction-free view for partner meetings.
11. **Export for submissions**: export heat maps and charts for reports and FDA submissions.

## Background

We build blood vessel mimics. Industry partners test their medical devices on our models, for example catheters, to measure:

- **Wall damage**: how much the device damages the vessel wall.
- **Navigation**: how well the device moves through tortuous (twisting) geometry compared with other devices on the market.

A single study can involve many vessels. The most recent one used **25 vessels**, each grown in its own bioreactor and given a different treatment:

- **Control**: no device, or a baseline condition.
- **Investigational device**: the partner's new product, often one going through FDA approval.
- **Market standard**: an existing approved device used for comparison.

After testing, each vessel is cut into sections and imaged, which gives hundreds of images per study. Damage is quantified by tracing the damaged areas in each image and counting the damaged pixels. Results are recorded as **percent damage** per image.

## Image naming convention (existing)

The app reads the file names we already use:

```
BRS24-10_4x_2_T_M2
```

| Part | Meaning | Values |
|---|---|---|
| `BRS24-10` | Bioreactor ID, which identifies the vessel and its treatment | Any ID |
| `4x` | Magnification | Normally `4x` |
| `2` | Section number | Usually 1–4 or 1–6, depending on the geometry |
| `T` | Side of the vessel | `T` = top, `B` = bottom |
| `M2` | Position within the section | `P` = proximal, `M1`, `M2`, … = medial (can be more than one), `D` = distal |

The bioreactor ID doesn't say which treatment was used, so the app also takes a **treatment key**: a small table matching each bioreactor ID to its treatment, for example `BRS24-10 → Control`. This can be a separate sheet or a column in the damage spreadsheet.

Images whose names don't match the format are flagged so they can be placed by hand.

## How it works

### 1. Load the model
- **STL file**: the partner's CAD model, exported from SolidWorks with *File → Save As → STL*.
- **Phone scan**: scan the physical vessel with a phone 3D-scanning app and upload the exported file (`.glb` or `.obj`).

### 2. Define sections
- Enter the number of sections, for example 4 or 6.
- The model is split along its centerline into that many sections, numbered from proximal to distal.
- Each section is divided into top and bottom halves, and into proximal, medial and distal positions along its length.

### 3. Upload images and data
- Upload a study's images all at once. Each image is placed from its file name.
- Upload the **Excel damage sheet**, with image names in one column and percent damage in another.
- Upload or enter the **treatment key**.

The images don't need to cover the whole vessel or overlap. They are pinned to locations, not stitched into one continuous surface.

### 4. Explore
- Markers show where each image was taken.
- Click a marker or section to open its images, each with its percent damage.
- Per-section summaries show average and maximum damage.

### 5. Damage heat map
- The model is colored by percent damage, from low to high, with a color scale legend.
- Locations with no image are shown in neutral gray, so missing data is never mistaken for zero damage.
- The color scale can be fixed across all vessels so colors are comparable between treatments.

### 6. Compare treatments
- Pick a bioreactor or treatment to view.
- Side-by-side view: two treatments on matching models, rotating together.
- Summary chart: average damage per treatment group.

## Confidentiality

Partner data is often confidential, especially for devices still in FDA review. The app is designed so that data stays private:

- **Processing happens on your computer.** Images, Excel sheets and models are opened in your browser. The app doesn't send them to a server, AI service or anyone else.
- **No AI in the app.** The viewer is ordinary code that reads file names and numbers. It doesn't analyze images with AI or send them to an AI.
- **Data is kept out of the repository.** Only the app code is stored on GitHub. Study images, spreadsheets and partner models are loaded from your computer when you use the app, and never committed. A `.gitignore` file blocks common data file types from being uploaded by accident.
- **Sharing with partners.** Show results in a live meeting, or give each partner only their own data. Avoid public links that contain partner data.

## Suggested tools

| Need | Tool | Why |
|---|---|---|
| 3D viewer | [Three.js](https://threejs.org) | The standard library for 3D in a web browser; free and well documented |
| App framework | React with Vite | Simple to build and runs fully in the browser |
| Excel reading | SheetJS (`xlsx`) | Reads `.xlsx` files directly in the browser |
| Phone scanning | Polycam, Scaniverse, or KIRI Engine | Free phone apps that export `.glb` / `.obj` |
| Charts | Chart.js or Recharts | Treatment comparison charts |
| Running it | Locally, or on private hosting | Keeps data on your machine |

## Saving, presenting and exporting

- **Save and reopen a study**: save the setup (model, section count, image placements, damage data and treatment key) as one project file on your computer. Opening the file restores the study exactly. It stays on your computer like any other confidential file.
- **Presentation mode**: hides editing controls and shows a clean view with a study title, company logo and color scale legend, ready for partner meetings.
- **Export for reports and submissions**: save high-resolution images of heat maps and charts (PNG, and SVG where possible), plus a PDF summary, for written reports and FDA submissions.

## More ideas

- **Statistics**: run the analysis in the app instead of separately in JMP:
  - Summary statistics per treatment group: mean, standard deviation, median, range and number of images
  - Comparisons between groups: ANOVA with post-hoc tests (for example Tukey HSD), or non-parametric tests (Kruskal–Wallis, Dunn) when the data isn't normally distributed
  - Breakdowns by section, top/bottom and position, to show where devices cause the most damage
  - Box plots with significance markers, exportable with the other charts
  - Export results as CSV so they can be checked in JMP
- **Image viewer tools**: zoom into images, flip between neighboring images, and optionally show the traced damage outline over the original.

## Roadmap

- [ ] **Phase 1**: Basic viewer that loads an STL / GLB model and supports rotate and zoom
- [ ] **Phase 2**: Split the vessel into a chosen number of sections, with top/bottom and P/M/D regions
- [ ] **Phase 3**: Upload images, parse file names, and place markers
- [ ] **Phase 4**: Click-to-view image panel
- [ ] **Phase 5**: Excel upload and damage heat map
- [ ] **Phase 6**: Treatment key and side-by-side comparison
- [ ] **Phase 7**: Save/open project files
- [ ] **Phase 8**: Presentation mode
- [ ] **Phase 9**: Export images, charts and PDF summaries
- [ ] **Phase 10**: Statistics
