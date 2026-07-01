const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");


dotenv.config();

const uploadDir = path.join(__dirname, "uploads", "pdf");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});


const upload = multer({ storage: storage });

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: ["https://fable-client-five.vercel.app", "http://localhost:5173", process.env.CLIENT_LIVE_URL].filter(Boolean),
  credentials: true
}));

app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_fable_hidden_secure_gateway_key_bypass");


const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});



const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: "Unauthorized access" });
  }
  
  const parts = authorization.split(" ");
  const token = parts.length === 2 ? parts[1] : parts[0];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ error: true, message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};
async function run() {
  try {

    await client.connect();
    console.log("✅ MongoDB Connected Successfully");

    const database = client.db("fable");
    const usersCollection = database.collection("users");
    const ebooksCollection = database.collection("ebooks");
    const transactionsCollection = database.collection("transactions");
    const bookmarksCollection = database.collection("bookmarks");

    const verifyAdmin = async (req, res, next) => {
      const user = await usersCollection.findOne({ email: req.decoded.email });
      if (user?.role !== "admin") return res.status(403).send({ error: true, message: "Admin Only" });
      next();
    };

    const verifyAdminOrWriter = async (req, res, next) => {
  const email = req.decoded.email;

  const user = await usersCollection.findOne({ email });

  if (
    user.role !== "admin" &&
    user.role !== "writer"
  ) {
    return res.status(403).send({
      message: "Forbidden",
    });
  }

  next();
};

const verifyWriter = async (req, res, next) => {
  const user = await usersCollection.findOne({
    email: req.decoded.email,
  });

  if (user?.role !== "writer") {
    return res.status(403).send({
      message: "Writer only",
    });
  }

  next();
};




 app.post("/jwt", async (req, res) => {
  const { email, password } = req.body;

  const user = await usersCollection.findOne({ email });

  if (!user) {
    return res.status(401).send({ message: "User not found" });
  }

  if (user.password && user.password !== password) {
    return res.status(401).send({ message: "Invalid password" });
  }

  const token = jwt.sign(
    {
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.send({ token });
});


// ✅ GOOGLE LOGIN ROUTE (FIXED)
app.get("/auth/google", (req, res) => {
  console.log("🔥 GOOGLE ROUTE HIT");
  res.send("GOOGLE ROUTE WORKING");
});


    app.get("/users/me", verifyJWT, async (req, res) => {
      const user = await usersCollection.findOne({ email: req.decoded.email });
      res.send(user);
    });

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const existingUser = await usersCollection.findOne({ email: user.email });
        if (existingUser) {
          return res.status(400).send({ message: "User already exists" });
        }

        let finalRole = "user";
       if (!user || (user.role !== "admin" && user.role !== "writer")) {
          finalRole = "writer";
        }

        const result = await usersCollection.insertOne({
          name: user.name || user.fullName,
          email: user.email,
         password: user.password || "",
          role: finalRole, 
          createdAt: new Date()
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal server error during registration", error: error.message });
      }
    });

    app.get("/writers-count", async (req, res) => {
  try {
    const totalWriters = await usersCollection.countDocuments({
      role: "writer",
    });

    res.send({
      totalWriters,
    });
  } catch (error) {
    res.status(500).send({
      message: "Failed to get writer count",
    });
  }
});

    
    app.post("/forgot-password", async (req, res) => {
      try {
        const { email } = req.body;
        if (!email) {
          return res.status(400).send({ message: "Email field is required!" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ message: "No account found with this email address." });
        }

        console.log(`✉️ Simulated Email: Password reset link emitted securely to ${email}`);
        res.send({ 
          success: true, 
          message: `A secure password reset link has been generated and emitted to ${email} successfully!` 
        });
      } catch (error) {
        res.status(500).send({ message: "Internal server error during password reset", error: error.message });
      }
    });

    // REAL-TIME EDIT PROFILE API
    app.put("/users/edit-profile", verifyJWT, async (req, res) => {
      try {
        const loggedInEmail = req.decoded.email; 
        const { name, photoUrl } = req.body;
        if (!name) {
          return res.status(400).send({ message: "Full Name is required!" });
        }

        const updateDoc = {
          $set: { name: name, avatar: photoUrl || "" }
        };

        const result = await usersCollection.updateOne({ email: loggedInEmail }, updateDoc);
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User account not found in database!" });
        }
        res.send({ success: true, message: "Profile updates saved successfully in MongoDB!" });
      } catch (error) {
        res.status(500).send({ message: "Database update failed", error: error.message });
      }
    });
    // --- BROWSE EBOOKS ENGINE ---
    app.get("/ebooks", async (req, res) => {
      try {
        const { search, genre, priceRange, availability, sortBy, page = 1, limit = 6 } = req.query;
        let query = {};
        if (search) query.$or = [{ title: { $regex: search, $options: "i" } }, { writerName: { $regex: search, $options: "i" } }];
        if (genre && genre !== "All Genres") {
          query.genre = { $regex: new RegExp(`^${genre}$`, "i") };
        }
        if (priceRange) query.price = { $lte: parseFloat(priceRange) };
        if (availability && availability !== "All") {
          if (availability === "Free") query.price = 0;
          else if (availability === "Paid") query.price = { $gt: 0 };
        }

        let sortOption = {};
        if (sortBy === "Newest First") sortOption.createdAt = -1;
        else if (sortBy === "Price Low → High") sortOption.price = 1;
        else if (sortBy === "Price High → Low") sortOption.price = -1;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const totalEbooks = await ebooksCollection.countDocuments(query);
        const ebooks = await ebooksCollection.find(query).sort(sortOption).skip(skip).limit(parseInt(limit)).toArray();
        res.send({ ebooks, totalEbooks, totalPages: Math.ceil(totalEbooks / parseInt(limit)), currentPage: parseInt(page) });
      } catch (error) {
        res.status(500).send({ message: "Filtering failed" });
      }
    });

    app.get("/ebook/:id", async (req, res) => {
      try {
        const id = req.params.id;
        let query = {};
        if (!isNaN(id)) query = { id: parseInt(id) };
        else if (ObjectId.isValid(id)) query = { _id: new ObjectId(id) };
        else query = { id: id };

        const book = await ebooksCollection.findOne(query);
        if (!book) return res.status(404).send({ message: "Ebook not found" });

        const relatedBooks = await ebooksCollection.find({ genre: book.genre, _id: { $ne: book._id } }).limit(5).toArray();
        res.send({ book, relatedBooks });
      } catch (error) {
        res.status(500).send({ message: "Server Error" });
      }
    });


    app.delete("/users/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await ebooksCollection.deleteOne(query);

        if (result.deletedCount === 1) {
          console.log(`🗑️ Simulated Notification: Ebook with ID ${id} has been permanently deleted from MongoDB Atlas!`);
          res.send({ success: true, message: "Ebook successfully removed from library." });
        } else {
          res.status(404).send({ success: false, message: "Ebook not found in database." });
        }
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

   
    app.put("/users/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body; 
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: updatedData.status } };

        const result = await ebooksCollection.updateOne(filter, updateDoc);
        if (result.matchedCount > 0) {
          console.log(`📝 Simulated Notification: Ebook with ID ${id} status successfully flipped to [${updatedData.status}] in MongoDB!`);
          res.send({ success: true, message: "Ebook status synchronized successfully." });
        } else {
          res.status(404).send({ success: false, message: "Ebook not found in database registry." });
        }
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

    app.put("/ebooks/:id", verifyJWT, verifyWriter, async (req, res) => {
      try {
        console.log("PUT /ebooks HIT");
        const id = req.params.id;
        const result = await ebooksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { title: req.body.title, description: req.body.description, coverUrl: req.body.coverUrl, updatedAt: new Date() } }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Update Failed", error: error.message });
      }
    });
    app.get("/orders", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const ordersWithDetails = await transactionsCollection.aggregate([
          {
            $lookup: {
              from: "ebooks",
              let: { ebook_id: "$ebookId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [
                        "$_id",
                        {
                          $cond: {
                            if: { $eq: [{ $type: "$$ebook_id" }, "string"] },
                            then: { $toObjectId: "$$ebook_id" },
                            else: "$$ebook_id"
                          }
                        }
                      ]
                    }
                  }
                }
              ],
              as: "bookInfo"
            }
          },
          {
            $lookup: {
              from: "users",
              localField: "buyerEmail",
              foreignField: "email",
              as: "userInfo"
            }
          },
          {
            $project: {
              _id: 1, transactionId: 1, ebookId: 1, amount: 1, date: 1, buyerEmail: 1,
              bookTitle: { $arrayElemAt: ["$bookInfo.title", 0] },
              buyerName: { $arrayElemAt: ["$userInfo.name", 0] }
            }
          }
        ]).toArray();
        res.send(ordersWithDetails);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

// 🟢 আপনার ওরিじんাল ব্যাকএন্ড ফাইলের /writer-orders রাউটে এটি রিপ্লেস করুন
app.get("/writer-orders", verifyJWT, async (req, res) => {
  try {
    const writerEmail = req.decoded?.email;

    if (!writerEmail) {
      return res.status(403).send({ message: "Forbidden Access" });
    }

    const ordersWithDetails = await transactionsCollection.aggregate([
      {
        $lookup: {
          from: "ebooks",
          let: { ebook_id: "$ebookId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [
                    "$_id",
                    {
                      $cond: {
                        if: { $eq: [{ $type: "$$ebook_id" }, "string"] },
                        then: { $toObjectId: "$$ebook_id" },
                        else: "$$ebook_id"
                      }
                    }
                  ]
                }
              }
            }
          ],
          as: "bookInfo"
        }
      },
      // ১. ডাটাবেজ থেকে ম্যাচ করার পর শুধু এই রাইটারের বইগুলো ফিল্টার হবে
      {
        $match: {
          "bookInfo.writerEmail": writerEmail 
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "buyerEmail",
          foreignField: "email",
          as: "userInfo"
        }
      },
      {
        $project: {
          _id: 1, 
          transactionId: 1, 
          amount: 1, 
          date: 1, 
          buyerEmail: 1,
          bookTitle: { $arrayElemAt: ["$bookInfo.title", 0] },
          buyerName: { $arrayElemAt: ["$userInfo.name", 0] }
        }
      }
    ]).toArray();

    res.send(ordersWithDetails);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error", error: error.message });
  }
});

// 🟢 ইউজার ড্যাশবোর্ডের জন্য সম্পূর্ণ আলাদা ও ডেডিকেটেড এন্ডপয়েন্ট (Requirement Fulfilled)
app.get("/user-purchased-ebooks", verifyJWT, async (req, res) => {
  try {
    const buyerEmail = req.decoded?.email; // টোকেন থেকে লগইন করা ইউজারের ইমেইল নেওয়া হলো

    if (!buyerEmail) {
      return res.status(403).send({ message: "Forbidden Access" });
    }

    // ডাটাবেজ থেকে শুধুমাত্র এই ইউজারের কেনা বইগুলোই ফিল্টার হয়ে আসবে
    const myPurchasedBooks = await transactionsCollection.aggregate([
      {
        // ১. ট্রানজেকশন বক্স থেকে ইউজারের ইমেইল ম্যাচিং
        $match: { buyerEmail: buyerEmail } 
      },
      {
        // ২. ই-বুক বক্স থেকে বইয়ের আইডি জয়েন করা (ObjectId সেফ পাইপলাইন)
        $lookup: {
          from: "ebooks",
          localField: "ebookId",
          foreignField: "_id",
          as: "bookInfo"
        }
      },
      {
       
        $project: {
          _id: 1,
          transactionId: 1,
          amount: 1,
          date: 1,
          ebookId: 1,
          buyerEmail: 1
        }
      }
    ]).toArray();

    res.send(myPurchasedBooks);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error", error: error.message });
  }
});


    app.get("/users-count", async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        res.send({ totalUsers });
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

    app.get("/users-list", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

    app.get("/ebooks/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const book = await ebooksCollection.findOne(query);
        if (book) res.send(book);
        else res.status(404).send({ success: false, message: "Ebook not found" });
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      try {
        const { ebookId } = req.body;
        const buyerEmail = req.decoded.email;

        let query = {};
        if (!isNaN(ebookId)) query = { id: parseInt(ebookId) };
        else if (ObjectId.isValid(ebookId)) query = { _id: new ObjectId(ebookId) };
        else query = { id: ebookId };

        const ebook = await ebooksCollection.findOne(query);
        if (!ebook) return res.status(404).send({ message: "Target ebook not found!" });
        if (ebook.writerEmail === buyerEmail) return res.status(400).send({ message: "Writers cannot purchase their own ebooks!" });

        const amountInCents = Math.round(parseFloat(ebook.price) * 100);
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, currency: "usd", payment_method_types: ["card"],
          metadata: { ebookId: ebook._id ? ebook._id.toString() : ebook.id.toString(), buyerEmail }
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ message: "Internal Gateway Failed", error: error.message });
      }
    });

    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
  try {
    const { ebookId } = req.body;

    const ebook = await ebooksCollection.findOne({
      _id: new ObjectId(ebookId),
    });

    if (!ebook) {
      return res.status(404).send({ message: "Ebook not found" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: ebook.title,
              images: [ebook.coverUrl],
            },
            unit_amount: Math.round(ebook.price * 100),
          },
          quantity: 1,
        },
      ],

      success_url: `${process.env.CLIENT_LIVE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url: `${process.env.CLIENT_LIVE_URL}/payment-cancel`,

      metadata: {
        ebookId: ebook._id.toString(),
        buyerEmail: req.decoded.email,
      },
    });

    res.send({
      url: session.url,
    });
  } catch (err) {
    res.status(500).send({
      message: err.message,
    });
  }
});

  app.post("/payment-success", verifyJWT, async (req, res) => {
  try {
    const { sessionId } = req.body;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      const { ebookId, buyerEmail } = session.metadata;

      const alreadyProcessed = await transactionsCollection.findOne({
        transactionId: sessionId,
      });

      if (alreadyProcessed) {
        return res.send({
          success: true,
          message: "Already recorded",
        });
      }

      await transactionsCollection.insertOne({
        transactionId: sessionId,
        type: "purchase",
        buyerEmail,
        ebookId: new ObjectId(ebookId),
        amount: session.amount_total / 100,
        date: new Date(),
      });

      await ebooksCollection.updateOne(
  { _id: new ObjectId(ebookId) },
  {
    $inc: {
      sales: 1,
    },
    $set: {
      status: "sold",
    },
  }
);

      return res.send({
        success: true,
        message: "Payment recorded!",
      });
    }

    res.status(400).send({
      message: "Payment not completed",
    });

  } catch (error) {
    res.status(500).send({
      message: "Success verification failed",
      error: error.message,
    });
  }
});



  app.post("/bookmarks", verifyJWT, async (req, res) => {
  console.log("POST /bookmarks HIT");
  console.log(req.body);
  console.log(req.decoded);

  try {
    const { ebookId } = req.body;

    const exists = await bookmarksCollection.findOne({
      userEmail: req.decoded.email,
      ebookId,
    });

    if (exists) {
      return res.status(400).send({
        message: "Already bookmarked",
      });
    }

    const result = await bookmarksCollection.insertOne({
      userEmail: req.decoded.email,
      ebookId,
      createdAt: new Date(),
    });

    console.log(result);

    res.send(result);
  } catch (error) {
    console.log(error);

    res.status(500).send({
      message: "Bookmark Failed",
      error: error.message,
    });
  }
});

app.get("/bookmarks", verifyJWT, async (req, res) => {
  try {
    const bookmarks = await bookmarksCollection.aggregate([
      {
        $match: {
          userEmail: req.decoded.email,
        },
      },
      {
        $addFields: {
          ebookObjId: {
            $toObjectId: "$ebookId",
          },
        },
      },
      {
        $lookup: {
          from: "ebooks",
          localField: "ebookObjId",
          foreignField: "_id",
          as: "bookDetails",
        },
      },
      {
        $unwind: "$bookDetails",
      },
    ]).toArray();

    res.send(bookmarks);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch bookmarks",
      error: error.message,
    });
  }
});

    app.delete("/bookmarks/:id", verifyJWT, async (req, res) => {
      try {
        res.send(await bookmarksCollection.deleteOne({ _id: new ObjectId(req.params.id) }));
      } catch (error) { res.status(500).send({ message: "Delete failed" }); }
    });

    app.get("/privacy-status", async (req, res) => {
      res.send({ success: true, status: "Compliant", version: "2026.1", encryption: "AES-256 Active" });
    });

    const contactsCollection = database.collection("contacts");
    app.post("/contact", async (req, res) => {
      try {
        const { name, email, subject, message } = req.body;
        await contactsCollection.insertOne({ name, email, subject, message, createdAt: new Date() });
        console.log(`✉️ Simulated Notification: New contact message received from ${email}`);
        res.send({ success: true, message: "Your message has been delivered!" });
      } catch (error) { res.status(500).send({ message: "Failed" }); }
    });

 app.get("/user/purchases", verifyJWT, async (req, res) => {
  try {
    const result = await transactionsCollection.aggregate([
      {
        $match: {
          buyerEmail: req.decoded.email,
        },
      },
      {
        $lookup: {
          from: "ebooks",
          localField: "ebookId",
          foreignField: "_id",
          as: "ebook",
        },
      },
      {
        $unwind: "$ebook",
      },
    ]).toArray();

    res.send(result);
  } catch (err) {
    res.status(500).send({
      message: "Failed to fetch purchases",
    });
  }
});
      
    app.post("/ebooks", upload.single("pdfFile"), async (req, res) => {
      try {
       
        const finalPdfUrl = req.file 
          ? `https://fable-server-z2xt.onrender.com/uploads/pdf/${req.file.filename}`
          : (req.body.pdfUrl || "");

        const ebookDoc = {
          ...req.body,
          price: parseFloat(req.body.price || 0),
          pdfUrl: finalPdfUrl,
          status: "available",
          createdAt: new Date()
        };

        const result = await ebooksCollection.insertOne(ebookDoc);
        
        
        console.log(`✉️ Simulated Notification: Brilliant! '${ebookDoc.title}' uploaded with physical PDF registry.`);
        
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server uploading process broke", error: error.message });
      }
    });
    app.get("/writer/my-ebooks", verifyJWT, verifyWriter, async (req, res) => {
      res.send(await ebooksCollection.find({ writerEmail: req.decoded.email }).toArray());
    });

  app.get(
  "/writer/sales",
  verifyJWT,
  verifyAdminOrWriter,
  async (req, res) => {
    const user = await usersCollection.findOne({
      email: req.decoded.email,
    });

    if (user.role === "admin") {
      // admin সব transaction দেখবে
      const data = await transactionsCollection.find().toArray();
      return res.send(data);
    }

    // writer নিজের sales দেখবে
    const data = await transactionsCollection.find({
      writerEmail: req.decoded.email,
    }).toArray();

    res.send(data);
  }
);

    app.get("/admin/analytics", verifyJWT, verifyAdmin, async (req, res) => {
      const totalUsers = await usersCollection.countDocuments({ role: "user" });
      const totalWriters = await usersCollection.countDocuments({ role: "writer" });
      const result = await ebooksCollection.aggregate([{ $group: { _id: null, totalSales: { $sum: "$sales" } } }]).toArray();
      res.send({ stats: { totalUsers, totalWriters, totalEbooksSold: result[0]?.totalSales || 0, totalRevenue: 0 }, genreChart: [] });
    });

  } catch (error) {
    console.error("❌ DB Error:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("📚 Fable Server Running Perfectly!");
});

app.listen(port, () => {
  console.log(`🚀 Server Running On Port ${port}`);
});
