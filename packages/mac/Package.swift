// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "StepByStep",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "StepByStepNucleo", path: "Sources/StepByStepNucleo"),
    .executableTarget(
      name: "StepByStep", dependencies: ["StepByStepNucleo"], path: "Sources/StepByStep",
      linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("ApplicationServices"), .linkedFramework("CoreGraphics"),
                       .linkedFramework("ScreenCaptureKit"), .linkedFramework("Vision"), .linkedFramework("ImageIO"),
                       .linkedFramework("UniformTypeIdentifiers")]),
    .testTarget(name: "StepByStepNucleoTests", dependencies: ["StepByStepNucleo"], path: "Tests/StepByStepNucleoTests")
  ])
