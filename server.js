const express = require("express"),
  app = express(),
  path = require("path"),
  bodyParser = require("body-parser");

app.set("views", "./public");
app.set("view engine", "ejs");
app.use(require("./bot.js"));
app.use(
  bodyParser.urlencoded({
    extended: false
  })
);
app.use(bodyParser.json());
app.use(require("./router.js"));

const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});
