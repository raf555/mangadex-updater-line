const express = require("express"),
  app = express.Router(),
  line = require("@line/bot-sdk"),
  config = {
    channelAccessToken: process.env.acc_token,
    channelSecret: process.env.acc_secret
  },
  client = new line.Client(config),
  xmlparser = require("fast-xml-parser"),
  editJsonFile = require("edit-json-file"),
  axios = require("axios"),
  { Mangadex } = require("mangadex-api"),
  mclient = new Mangadex(),
  cron = require("node-cron");

app.post("/callback", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(e => {
      console.log(e);
    });
});

// check manga every minute
cron.schedule("* * * * *", () => {
  getUpdate();
});

// check dex update
async function getUpdate() {
  let file = editJsonFile(`db/mangadex.json`);
  let data = await axios.get(process.env.rss_url);
  let feed = xmlparser.parse(data.data).rss.channel.item;
  let date = feed[0].pubDate;

  console.log("1 min mangadex has passed");

  if (file.get("latest") != date) {
    file.set("latest", date);
    file.save();
    console.log("mangadex updated");
    return dex(null, true);
  }
}

async function handleEvent(event) {
  let type = event.type;

  switch (type) {
    case "follow":
      return followevent(event);
    case "message":
      return event.message.text ? parse(event) : false;
  }
}

function reply(event, message) {
  try {
    return client.replyMessage(event.replyToken, message);
  } catch (e) {
    return false;
  }
}

async function push(id, message) {
  try {
    let push = await client.pushMessage(id, message);
    let quota = editJsonFile("db/pushlimit.json");
    let month = convertTZ(new Date(), "Asia/Jakarta").getMonth() + 1;

    if (quota.get("month") != month) {
      quota.set("month", month);
      quota.set("quota", 500);
    }
    quota.set("quota", quota.get("quota") - 1);
    quota.save();

    return push;
  } catch (e) {
    return false;
  }
}

function followevent(event) {
  return reply(event, {
    type: "text",
    text:
      "Welcome to (Unofficial) Mangadex Notifier for LINE!\n\n" +
      "Available command: \n" +
      "!dex => to open your following list latest chapter update\n" +
      "!edit => to edit and see your following list\n\n" +
      "If you find any problem, please make an issue at https://github.com/raf555/mangadex-updater-line",
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "message",
            label: "!dex",
            text: "!dex"
          }
        },
        {
          type: "action",
          action: {
            type: "message",
            label: "!edit",
            text: "!edit"
          }
        }
      ]
    }
  });
}

async function parse(event) {
  let text = event.message.text;
  let sign = text[0];
  let cmd = text.toLowerCase().substring(1);
  let added = false;
  let userdb = editJsonFile("db/user.json");

  try {
    let userdata = await client.getProfile(event.source.userId);
    userdb.set(userdata.userId + ".name", userdata.displayName);
    userdb.set(userdata.userId + ".pic", userdata.pictureUrl);
    userdb.save();
    added = true;
  } catch (e) {
    added = false;
  }

  if (sign == "!") {
    if (added) {
      switch (cmd) {
        case "dex":
          return dex(event);
        case "edit":
          return edit(event);
        default:
          return;
      }
    } else {
      return reply(event, {
        type: "text",
        text: "You haven't added bot yet, please add bot first."
      });
    }
  }
}

function edit(event) {
  let bubble = {
    type: "bubble",
    size: "nano",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "Edit",
            uri: process.env.liff_url
          },
          style: "primary"
        }
      ]
    }
  };
  return reply(event, {
    type: "flex",
    altText: "Edit Manga",
    contents: bubble,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "message",
            label: "List",
            text: "!dex"
          }
        }
      ]
    }
  });
}

async function dex(event, pushh) {
  // MANGADEX

  // database
  let _manga = editJsonFile(`db/_dexmanga.json`);
  let _user = editJsonFile(`db/_dexuser.json`);

  // carousel
  let carousel = {
    type: "carousel",
    contents: []
  };

  // edit bubble
  let editb = {
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "Edit",
            uri: process.env.liff_url
          },
          height: "sm",
          margin: "sm",
          style: "secondary"
        }
      ],
      offsetTop: "80px"
    },
    styles: {
      header: {
        backgroundColor: "#ECEFF1"
      }
    }
  };

  // dex rss
  let data = await axios.get(process.env.rss_url);
  let feed = xmlparser.parse(data.data).rss.channel.item;

  if (!pushh) {
    if (_user.get(event.source.userId)) {
      let usermanga = Object.keys(_user.get(event.source.userId));
      for (let i = 0; i < feed.length; i++) {
        if (carousel.contents.length == 11) {
          break;
        }
        let mangid = feed[i].mangaLink.split("/")[
          feed[i].mangaLink.split("/").length - 1
        ];
        for (let j = 0; j < usermanga.length; j++) {
          if (parseInt(usermanga[j]) == mangid) {
            let bubble = createdexbubble(feed[i]);
            carousel.contents.push(bubble);
            break;
          }
        }
      }
      carousel.contents.push(editb);
      //console.log(JSON.stringify(carousel));

      if (carousel.contents.length == 0) {
        return reply(event, {
          type: "text",
          text:
            "You haven't followed any manga or there is no update based on your following list."
        });
      }

      return reply(event, {
        type: "flex",
        altText: "Mangadex Update",
        contents: carousel,
        sender: {
          name: "MangaDex Update",
          iconUrl: "https://mangadex.org/favicon-192x192.png"
        },
        quickReply: {
          items: [
            {
              type: "action",
              action: {
                type: "message",
                label: "Edit",
                text: "!edit"
              }
            }
          ]
        }
      });
    } else {
      return reply(event, {
        type: "text",
        text: "You haven't followed any manga."
      });
    }
  } else {
    let apdetid = feed[0].mangaLink.split("/")[
      feed[0].mangaLink.split("/").length - 1
    ];
    let user = _manga.get(apdetid + ".follower");
    let alttext = "";

    if (user) {
      let userdata = Object.keys(user);
      for (let k = 0; k < userdata.length; k++) {
        let usermanga = Object.keys(_user.get(userdata[k]));
        for (let i = 0; i < feed.length; i++) {
          if (carousel.contents.length == 11) {
            break;
          }
          let mangid = feed[i].mangaLink.split("/")[
            feed[i].mangaLink.split("/").length - 1
          ];
          for (let j = 0; j < usermanga.length; j++) {
            if (parseInt(usermanga[j]) == mangid) {
              let bubble = createdexbubble(feed[i]);
              carousel.contents.push(bubble);
              alttext = feed[i].title;
              break;
            }
          }

          break; // show only one bubble when update
        }

        //carousel.contents.push(editb);

        if (carousel.contents.length == 0) {
          return push(userdata[k], {
            type: "text",
            text:
              "You haven't followed any manga or there is no update based on your following list."
          });
        } else {
          return push(userdata[k], {
            type: "flex",
            altText: "Mangadex Update - " + alttext,
            contents: carousel,
            sender: {
              name: "MangaDex Update",
              iconUrl: "https://mangadex.org/favicon-192x192.png"
            },
            quickReply: {
              items: [
                {
                  type: "action",
                  action: {
                    type: "message",
                    label: "List",
                    text: "!dex"
                  }
                },
                {
                  type: "action",
                  action: {
                    type: "message",
                    label: "Edit",
                    text: "!edit"
                  }
                }
              ]
            }
          });
        }
      }
    }
  }
}

function createdexbubble(data) {
  let title = data.title;

  let chapter = title.split(" - ")[1];
  title = title.split(" - ")[0];

  let link = data.link;
  let date = dateTodate(convertTZ(new Date(data.pubDate), "Asia/Jakarta"));

  let group = data.description;
  group = group.split(" - ")[0];

  let regex = /Group: ([\d\D]*)/gi;
  group = regex.exec(group)[1];

  let lang = data.description;
  lang = lang.split(" - ");
  regex = /Language: ([\d\D]*)/gi;
  lang = regex.exec(lang)[1];

  return {
    type: "bubble",
    size: "micro",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "" + title,
          weight: "bold",
          size: "sm",
          wrap: true
        },
        {
          type: "text",
          text: "" + chapter,
          size: "xxs"
        }
      ],
      height: "100px"
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "Date",
                  wrap: true,
                  color: "#8c8c8c",
                  size: "xxs"
                },
                {
                  type: "text",
                  text: "" + date,
                  size: "xxs",
                  align: "end"
                }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "Language",
                  wrap: true,
                  color: "#8c8c8c",
                  size: "xxs"
                },
                {
                  type: "text",
                  text: "" + lang,
                  size: "xxs",
                  align: "end",
                  wrap: true
                }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "Group",
                  wrap: true,
                  color: "#8c8c8c",
                  size: "xxs"
                },
                {
                  type: "text",
                  text: "" + group,
                  size: "xxs",
                  align: "end",
                  wrap: true
                }
              ]
            }
          ]
        }
      ],
      spacing: "sm",
      paddingAll: "13px"
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "separator"
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "open",
            uri: "" + link
          },
          height: "sm",
          margin: "sm",
          style: "secondary"
        }
      ]
    },
    styles: {
      header: {
        backgroundColor: "#ECEFF1"
      }
    }
  };
}

// convert timezone
function convertTZ(date, tzString) {
  return new Date(
    (typeof date === "string" ? new Date(date) : date).toLocaleString("en-US", {
      timeZone: tzString
    })
  );
}

// convert Date to string
function dateTodate(d) {
  var tgl = d.getDate() < 10 ? "0" + d.getDate() : d.getDate();
  var mon = d.getMonth() + 1 < 10 ? "0" + (d.getMonth() + 1) : d.getMonth() + 1;
  return tgl + "-" + mon + "-" + d.getFullYear();
}

module.exports = app;
