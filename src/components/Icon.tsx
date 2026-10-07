// Line icons in the style of lucide (MIT), drawn inline so no package is needed.
type Shape = ["path", string] | ["circle", number, number, number] | ["rect", number, number, number, number, number];

const icons = {
  dashboard: [["rect", 3, 3, 7, 9, 1], ["rect", 14, 3, 7, 5, 1], ["rect", 14, 12, 7, 9, 1], ["rect", 3, 16, 7, 5, 1]],
  wrench: [["path", "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"]],
  users: [["path", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"], ["circle", 9, 7, 4], ["path", "M22 21v-2a4 4 0 0 0-3-3.87"], ["path", "M16 3.13a4 4 0 0 1 0 7.75"]],
  package: [["path", "M16.5 9.4 7.55 4.24"], ["path", "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"], ["path", "M3.3 7 12 12l8.7-5"], ["path", "M12 22V12"]],
  settings: [["path", "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"]],
  logout: [["path", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"], ["path", "m16 17 5-5-5-5"], ["path", "M21 12H9"]],
  panel: [["rect", 3, 3, 18, 18, 2], ["path", "M9 3v18"]],
  plus: [["path", "M5 12h14M12 5v14"]],
  search: [["circle", 11, 11, 8], ["path", "m21 21-4.3-4.3"]],
  printer: [["path", "M6 9V2h12v7"], ["path", "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"], ["rect", 6, 14, 12, 8, 0]],
  mail: [["rect", 2, 4, 20, 16, 2], ["path", "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"]],
  phone: [["path", "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"]],
  message: [["path", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]],
  trash: [["path", "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"]],
  external: [["path", "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"]],
  pencil: [["path", "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"]],
  x: [["path", "M18 6 6 18M6 6l12 12"]],
  back: [["path", "m12 19-7-7 7-7M19 12H5"]],
  chevronDown: [["path", "m6 9 6 6 6-6"]],
  tag: [["path", "M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"], ["path", "M7 7h.01"]],
  file: [["path", "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"], ["path", "M14 2v6h6M16 13H8M16 17H8"]],
  receipt: [["path", "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"], ["path", "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"]],
  alert: [["circle", 12, 12, 10], ["path", "M12 8v4M12 16h.01"]],
  check: [["path", "M20 6 9 17l-5-5"]],
  clock: [["circle", 12, 12, 10], ["path", "M12 6v6l4 2"]],
  building: [["rect", 4, 2, 16, 20, 2], ["path", "M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"]],
  home: [["path", "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"], ["path", "M9 22V12h6v10"]],
  palette: [["circle", 13.5, 6.5, 1], ["circle", 17.5, 10.5, 1], ["circle", 8.5, 7.5, 1], ["circle", 6.5, 12.5, 1], ["path", "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.56C21.96 6.01 17.46 2 12 2z"]],
  database: [["path", "M3 5c0-1.66 4-3 9-3s9 1.34 9 3-4 3-9 3-9-1.34-9-3"], ["path", "M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3"]],
  globe: [["circle", 12, 12, 10], ["path", "M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"]],
  barcode: [["path", "M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14"]],
  camera: [["path", "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"], ["circle", 12, 13, 3]],
  image: [["rect", 3, 3, 18, 18, 2], ["circle", 9, 9, 2], ["path", "m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"]],
  upload: [["path", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"], ["path", "m17 8-5-5-5 5M12 3v12"]],
  download: [["path", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"], ["path", "m7 10 5 5 5-5M12 15V3"]],
  chevronLeft: [["path", "m15 18-6-6 6-6"]],
  chevronRight: [["path", "m9 18 6-6-6-6"]],
  hardDrive: [["path", "M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"], ["path", "M6 16h.01M10 16h.01"]],
  checkSquare: [["rect", 3, 3, 18, 18, 2], ["path", "m9 12 2 2 4-4"]],
  user: [["circle", 12, 8, 4], ["path", "M20 21a8 8 0 0 0-16 0"]],
  menu: [["path", "M4 6h16M4 12h16M4 18h16"]],
  lock: [["rect", 3, 11, 18, 11, 2], ["path", "M7 11V7a5 5 0 0 1 10 0v4"]],
  eye: [["path", "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"], ["circle", 12, 12, 3]],
  eyeOff: [["path", "M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20M14.12 14.12a3 3 0 1 1-4.24-4.24"]],
  copy: [["rect", 9, 9, 13, 13, 2], ["path", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"]],
  server: [["rect", 2, 2, 20, 8, 2], ["rect", 2, 14, 20, 8, 2], ["path", "M6 6h.01M6 18h.01"]],
  book: [["path", "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"]],
  bell: [["path", "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"], ["path", "M10.3 21a1.94 1.94 0 0 0 3.4 0"]],
  scan: [["path", "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"]],
  calendar: [["rect", 3, 4, 18, 18, 2], ["path", "M16 2v4M8 2v4M3 10h18"]],
  chart: [["path", "M3 3v18h18"], ["path", "M7 16v-5M12 16V7M17 16v-8"]],
  activity: [["path", "M22 12h-4l-3 9L9 3l-3 9H2"]],
  dollar: [["path", "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof icons;

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {(icons[name] as Shape[]).map((shape, index) => {
        if (shape[0] === "path") return <path key={index} d={shape[1]} />;
        if (shape[0] === "circle") return <circle key={index} cx={shape[1]} cy={shape[2]} r={shape[3]} />;
        return <rect key={index} x={shape[1]} y={shape[2]} width={shape[3]} height={shape[4]} rx={shape[5]} />;
      })}
    </svg>
  );
}
