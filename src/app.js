// @ts-check

const die = (why) => {
  throw new Error(why);
};
const inputElement = document.querySelector('input[type="file"]') || die();

inputElement.addEventListener(
  "change",
  async (ev) => {
    const [file] = ev.target?.files;
    console.log({ file });
    const fr = new FileReader();
    fr.addEventListener("load", () => {
      const txt = fr.result;
      console.log({ txt: txt.slice(0, 80) });
    });
    if (file) {
      fr.readAsText(file);
    }
    alert("bing!");
  },
  false
);
