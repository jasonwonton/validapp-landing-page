// Prints macOS Vision face anchors for photos, the reference the web face box
// and anchor points were calibrated against (tests/fixtures/lenses).
//   swift scripts/lenses/vision-reference.swift tests/fixtures/lenses/solo.jpg ...

import Foundation
import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let img = NSImage(contentsOf: url), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let req = VNDetectFaceLandmarksRequest()
    try! VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    let W = CGFloat(cg.width), H = CGFloat(cg.height)
    for face in req.results ?? [] {
        let b = face.boundingBox
        func c(_ r: VNFaceLandmarkRegion2D?) -> String {
            guard let pts = r?.normalizedPoints, !pts.isEmpty else { return "null" }
            let x = pts.map{$0.x}.reduce(0,+)/CGFloat(pts.count), y = pts.map{$0.y}.reduce(0,+)/CGFloat(pts.count)
            let gx = b.minX + x*b.width, gy = b.minY + y*b.height
            return String(format: "[%.4f,%.4f]", gx, 1-gy)
        }
        var ratio = -1.0
        if let p = face.landmarks?.innerLips?.normalizedPoints, p.count >= 4 {
            ratio = Double((p.map{$0.y}.max()! - p.map{$0.y}.min()!) / max(0.001, p.map{$0.x}.max()! - p.map{$0.x}.min()!))
        }
        print(String(format: "{\"file\":\"%@\",\"w\":%.0f,\"h\":%.0f,\"box\":[%.4f,%.4f,%.4f,%.4f],", url.lastPathComponent, W, H, b.minX, 1-b.maxY, b.width, b.height) + "\"leftEye\":\(c(face.landmarks?.leftEye)),\"rightEye\":\(c(face.landmarks?.rightEye)),\"nose\":\(c(face.landmarks?.nose)),\"mouth\":\(c(face.landmarks?.outerLips)),\"innerLipRatio\":\(ratio),\"roll\":\(face.roll?.doubleValue ?? 0)}")
    }
}
