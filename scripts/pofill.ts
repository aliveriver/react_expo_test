// 补丁
if (typeof (global as any).navigator === "undefined") {
  (global as any).navigator = {} as any;
}