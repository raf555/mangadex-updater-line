const express = require("express");
const app = express();
const path = require("path")
const bodyParser = require("body-parser")

app.set("views", path.join(__dirname, "public"));
app.set("view engine", "ejs");
app.use(require(__dirname + "/bot.js"));
app.use(
  bodyParser.urlencoded({
    extended: false
  })
);
app.use(bodyParser.json());
app.use(require(__dirname + "/router.js"));

const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});
