import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10;
const defaultPhotoUrl = "/assets/images/defaultprofileimage.jpg";
env.config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
    store: new session.MemoryStore(),
  })
);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.get("/", async (req, res) => {
  try {
    const isLoggedIn = req.isAuthenticated(); // Check if the user is authenticated
    let userPhotoUrl = null; // Initialize user photo URL

    // If the user is logged in, fetch the user's photo URL from the profile
    if (isLoggedIn) {
      userPhotoUrl = req.user.photo_path; // Assuming the profile photo URL is stored in req.user.profile_photo
    }

    // Fetch data for top 3 selling dogs
    const dogsResult = await db.query(`
      SELECT d.breed, COUNT(*) AS total_sales, d.price AS price_dog, d.age, d.description, d.image_url
      FROM Dog d
      JOIN Sale s ON d.id = s.dog_id
      GROUP BY d.breed, d.price, d.age, d.description, d.image_url
      ORDER BY total_sales DESC
      LIMIT 3;
    `);
    const topSellingDogs = dogsResult.rows;

    // Fetch testimonials data
    const testimonialsResult = await db.query(`
      SELECT s.*, t.*
      FROM Sale s
      LEFT JOIN Testimonials t ON s.id = t.sale_id;
    `);
    const testimonials = testimonialsResult.rows;

    // Render the EJS template with both top selling dogs, testimonials data, and user photo URL
    res.render("index.ejs", {
      isLoggedIn,
      userPhotoUrl,
      listItems: topSellingDogs,
      testimonials,
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

// Route to fetch dog data from the database
app.get("/dogs", async (req, res) => {
  try {
    const isLoggedIn = req.isAuthenticated(); // Check if the user is authenticated
    let userPhotoUrl = null; // Initialize user photo URL

    // If the user is logged in, fetch the user's photo URL from the profile
    if (isLoggedIn) {
      userPhotoUrl = req.user.photo_path; // Assuming the profile photo URL is stored in req.user.profile_photo
    }
    // Fetch dog data from the database
    const dogs = await db.query("SELECT * FROM Dog ORDER BY id ASC");

    // Render the EJS template and pass the dog data
    res.render("product.ejs", {
      isLoggedIn,
      userPhotoUrl,
      dogs: dogs.rows,
      noDogsFound: false,
    });
  } catch (err) {
    console.error("Error fetching dog data:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Route to fetch selected dog details from the database
app.get("/dogs/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const isLoggedIn = req.isAuthenticated(); // Check if the user is authenticated
    let userPhotoUrl = null; // Initialize user photo URL

    // If the user is logged in, fetch the user's photo URL from the profile
    if (isLoggedIn) {
      userPhotoUrl = req.user.photo_path; // Assuming the profile photo URL is stored in req.user.profile_photo
    }

    const result = await db.query("SELECT * FROM Dog WHERE id = $1", [id]);

    if (!result) {
      res.status(404).send("Dog not found");
      return;
    }

    res.render("detail.ejs", {
      isLoggedIn,
      userPhotoUrl,
      dogs: result.rows[0],
    });
  } catch (err) {
    console.error("Error fetching dog details:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/checkout", async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      let userPhotoUrl = null; // Initialize user photo URL

      userPhotoUrl = req.user.photo_path; // Assuming the profile photo URL is stored in req.user.profile_photo

      res.render("checkout.ejs", {
        isLoggedIn: true,
        userPhotoUrl,
      });
    } catch (err) {
      console.error("Error fetching dog details:", err);
      res.status(500).send("Internal Server Error");
    }
  } else {
    res.redirect("/login");
  }
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/furryfriends",
  passport.authenticate("google", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

// Route handler for /search POST request
app.post("/search", async (req, res) => {
  const searchQuery = req.body.search.toLowerCase();

  try {
    const result = await db.query(
      "SELECT * FROM Dog WHERE LOWER(breed) LIKE '%' || $1 || '%'",
      [searchQuery.toLowerCase()]
    );

    if (result.rows.length > 0) {
      res.render("product.ejs", { dogs: result.rows, noDogsFound: false });
    } else {
      res.render("product.ejs", { noDogsFound: true });
    }
  } catch (err) {
    console.error("Error searching for dogs:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Route to handle register form submission
app.post("/register", async (req, res) => {
  const firstName = req.body.firstname;
  const lastName = req.body.lastname;
  const email = req.body.email;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password, photo_path, firstname, lastname) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [email, hash, defaultPhotoUrl, firstName, lastName]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log("success");
            res.redirect("/");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

passport.use(
  "local",
  new Strategy({ usernameField: "email" }, async function (
    email,
    password,
    cb
  ) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [
        email,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb(null, false);
      }
    } catch (err) {
      console.error("Error finding user:", err);
      return cb(err);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/furryfriends",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        console.log(profile);
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password, photo_path, firstname, lastname) VALUES ($1, $2, $3, $4, $5)",
            [
              profile.email,
              "google",
              profile.picture,
              profile.given_name,
              profile.family_name,
            ]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);
passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
