// cribbed from https://esbuild.github.io/api/#serve-everything

require("esbuild")
  .serve(
    {
      servedir: "www",
    },
    {
      entryPoints: ["src/app.js"],
      outdir: "www/js",
      bundle: true,
    }
  )
  .then((server) => {
    console.log(`http://${server.host}:${server.port}`);
  })
  .then((server) => {
    // Call "stop" on the web server to stop serving
    // server.stop();
  });
