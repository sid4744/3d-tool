import { Vector3 } from 'three';
import { TentPole, TentData } from '../types';
import { jsPDF } from "jspdf";

/**
 * Generates a standard Wavefront OBJ string.
 * Exports sketch outline and vertical lines for poles.
 */
export const generateOBJ = (points: Vector3[], poles: TentPole[]): string => {
  let obj = "# Qtents 3D Tool Export\n";
  let vertexCount = 0;

  // 1. Export Sketch Vertices
  obj += "\n# Sketch Points\n";
  points.forEach(p => {
    obj += `v ${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)}\n`;
    vertexCount++;
  });

  // 2. Export Sketch Loop
  if (points.length > 1) {
    obj += "\n# Sketch Loop\n";
    obj += "l";
    for (let i = 1; i <= points.length; i++) {
      obj += ` ${i}`;
    }
    // Close the loop if needed
    obj += ` 1\n`;
  }

  // 3. Export Poles as Vertical Lines
  if (poles.length > 0) {
    obj += "\n# Pole Lines\n";
    poles.forEach(p => {
      // Base
      obj += `v ${p.position.x.toFixed(4)} ${p.position.y.toFixed(4)} ${p.position.z.toFixed(4)}\n`;
      // Top
      obj += `v ${p.position.x.toFixed(4)} ${(p.position.y + p.height).toFixed(4)} ${p.position.z.toFixed(4)}\n`;
      
      const baseIdx = vertexCount + 1;
      const topIdx = vertexCount + 2;
      vertexCount += 2;

      obj += `l ${baseIdx} ${topIdx}\n`;
    });
  }

  return obj;
};

/**
 * Generates a DXF string (AutoCAD R12 Format).
 * Exports sketch as POLYLINE and poles as 3D LINE entities.
 */
export const generateDXF = (points: Vector3[], poles: TentPole[]): string => {
  let dxf = "";
  
  // Header Section
  dxf += "0\nSECTION\n2\nHEADER\n";
  dxf += "9\n$ACADVER\n1\nAC1009\n"; // AC1009 = R12
  dxf += "0\nENDSEC\n";

  // Entities Section
  dxf += "0\nSECTION\n2\nENTITIES\n";

  // 1. Draw the Sketch Outline (POLYLINE entity)
  if (points.length > 0) {
    dxf += "0\nPOLYLINE\n";
    dxf += "8\nSketch_Outline\n"; 
    dxf += "66\n1\n"; // Vertices follow
    dxf += "70\n1\n"; // 1 = Closed polyline
    dxf += "10\n0.0\n20\n0.0\n30\n0.0\n"; 
    
    // Vertices
    points.forEach(p => {
      dxf += "0\nVERTEX\n";
      dxf += "8\nSketch_Outline\n";
      // 3D X -> CAD X, 3D Z -> CAD Y (Top view)
      dxf += `10\n${p.x.toFixed(4)}\n`;
      dxf += `20\n${(-p.z).toFixed(4)}\n`;
      dxf += "30\n0.0\n"; // Z is 0
    });

    dxf += "0\nSEQEND\n";
  }

  // 2. Draw Poles (3D LINE entities)
  poles.forEach(p => {
    // Base Point (In CAD coordinates: X=x, Y=-z, Z=0)
    const bx = p.position.x;
    const by = -p.position.z;
    const bz = 0;

    // Top Point (In CAD coordinates: Z=height)
    const tx = p.position.x;
    const ty = -p.position.z;
    const tz = p.height;

    dxf += "0\nLINE\n";
    dxf += "8\nPoles\n";
    // Start Point
    dxf += `10\n${bx.toFixed(4)}\n`;
    dxf += `20\n${by.toFixed(4)}\n`;
    dxf += `30\n${bz.toFixed(4)}\n`;
    // End Point
    dxf += `11\n${tx.toFixed(4)}\n`;
    dxf += `21\n${ty.toFixed(4)}\n`;
    dxf += `31\n${tz.toFixed(4)}\n`;
  });

  // End Entities
  dxf += "0\nENDSEC\n";
  dxf += "0\nEOF\n";

  return dxf;
};

export const generatePDF = (
  canvas: HTMLCanvasElement, 
  tentData: TentData, 
  formattedArea: string
) => {
  const doc = new jsPDF({
    orientation: 'landscape',
  });

  // Title
  doc.setFontSize(20);
  doc.text("Tent Design Specification", 20, 20);

  // Metadata
  doc.setFontSize(12);
  doc.text(`Fabric Area: ${formattedArea} m2`, 20, 35);
  doc.text(`Pole Count: ${tentData.poles.length}`, 20, 42);

  // Pole Table
  let y = 55;
  doc.setFontSize(14);
  doc.text("Pole Schedule", 20, y);
  y += 10;
  
  doc.setFontSize(10);
  doc.text("ID", 20, y);
  doc.text("Height (m)", 40, y);
  doc.text("Position (X, Z)", 70, y);
  y += 5;
  doc.line(20, y-2, 120, y-2); // header line

  tentData.poles.forEach((pole, i) => {
    y += 7;
    // Check for page break if list is very long (simplified here)
    if (y > 190) return; 

    doc.text(`${i + 1}`, 20, y);
    doc.text(`${pole.height.toFixed(2)}`, 40, y);
    doc.text(`${pole.position.x.toFixed(2)}, ${pole.position.z.toFixed(2)}`, 70, y);
  });

  // Add 3D View Image
  const imgData = canvas.toDataURL("image/png");
  // Calculate aspect ratio to fit on right side
  const imgWidth = 140;
  const imgHeight = (canvas.height / canvas.width) * imgWidth;
  
  doc.addImage(imgData, 'PNG', 130, 20, imgWidth, imgHeight);

  doc.save("qtents_design_sheet.pdf");
};

export const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};