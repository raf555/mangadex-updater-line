module.exports = {
  closed: true, // any request to mangadex from front web or bot, true/false
  checker: false, // auto check: true: on, false: off
  endpoint: "https://api.mangadex.org/v2/", // endpoint url

  // method
  pubDate: date => {
    //  https://gist.github.com/samhernandez/5260558
    var pieces = date.toString().split(" "),
      offsetTime = pieces[5].match(/[-+]\d{4}/),
      offset = offsetTime ? offsetTime : pieces[5],
      parts = [
        pieces[0] + ",",
        pieces[2],
        pieces[1],
        pieces[3],
        pieces[4],
        offset
      ];

    return parts.join(" ");
  },
  isAdmin: id => {
    return id == process.env.admin_id;
  },
  convertTZ: (date, tzString) => {
    return new Date(
      (typeof date === "string" ? new Date(date) : date).toLocaleString(
        "en-US",
        {
          timeZone: tzString
        }
      )
    );
  },
  dateTodate: d => {
    let tgl = d.getDate() < 10 ? "0" + d.getDate() : d.getDate();
    let mon =
      d.getMonth() + 1 < 10 ? "0" + (d.getMonth() + 1) : d.getMonth() + 1;
    return tgl + "-" + mon + "-" + d.getFullYear();
  },
  dateTohour: d => {
    let jam = d.getHours() < 10 ? "0" + d.getHours() : d.getHours();
    let mnt = d.getMinutes() < 10 ? "0" + d.getMinutes() : d.getMinutes();
    return jam + "." + mnt;
  },
  datetostr: (d, jam = true) => {
    let out = module.exports.dateTodate(d);
    if (jam) {
      out += " " + module.exports.dateTohour(d);
    }
    return out;
  }
};
