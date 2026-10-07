// seed.js
// Database Seeder for FoodieHub
// Run: npm run seed
// BTWA Module 1: Populating MongoDB collections
// BTWA Module 10: bcrypt password hashing

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");

dotenv.config();

// Import Models
const User = require("./models/User");
const Category = require("./models/Category");
const Food = require("./models/Food");
const Cart = require("./models/Cart");
const Order = require("./models/Order");

// ─── Sample Data ─────────────────────────────────────────────────────────────

const categories = [
  {
    name: "Biryani",
    description: "Aromatic rice dishes cooked with spices and meat or vegetables",
    image: "https://images.unsplash.com/photo-1563379091339-03246963d551?w=400",
  },
  {
    name: "Burger",
    description: "Juicy patties in toasted buns with fresh toppings",
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400",
  },
  {
    name: "Pizza",
    description: "Italian flatbread topped with sauce, cheese, and toppings",
    image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400",
  },
  {
    name: "Chinese",
    description: "Indo-Chinese fusion dishes with bold flavors",
    image: "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=400",
  },
  {
    name: "Desserts",
    description: "Sweet indulgences and traditional Indian sweets",
    image: "https://images.unsplash.com/photo-1547592180-85f173990554?w=400",
  },
  {
    name: "Beverages",
    description: "Refreshing drinks, juices, and coolers",
    image: "https://images.unsplash.com/photo-1544145945-f90425340c7e?w=400",
  },
  {
    name: "Snacks",
    description: "Light bites and appetizers to start your meal",
    image: "https://images.unsplash.com/photo-1541592553160-82008b127ccb?w=400",
  },
];

// Foods are built after categories are inserted (need ObjectIds)
const getFoods = (cats) => {
  const biryani = cats.find((c) => c.name === "Biryani")._id;
  const burger  = cats.find((c) => c.name === "Burger")._id;
  const pizza   = cats.find((c) => c.name === "Pizza")._id;
  const chinese = cats.find((c) => c.name === "Chinese")._id;
  const dessert = cats.find((c) => c.name === "Desserts")._id;
  const drinks  = cats.find((c) => c.name === "Beverages")._id;
  const snacks  = cats.find((c) => c.name === "Snacks")._id;

  return [
    {
      name: "Chicken Biryani",
      description: "Aromatic basmati rice cooked with tender chicken and whole spices",
      price: 220,
      category: biryani,
      image: "https://images.unsplash.com/photo-1563379091339-03246963d551?w=400",
      ingredients: ["Basmati Rice", "Chicken", "Saffron", "Onion", "Yogurt", "Spices"],
      available: true,
      rating: 4.8,
    },
    {
      name: "Mutton Biryani",
      description: "Slow-cooked mutton in fragrant basmati rice with dum cooking",
      price: 280,
      category: biryani,
      image: "https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=400",
      ingredients: ["Basmati Rice", "Mutton", "Saffron", "Fried Onion", "Ghee", "Spices"],
      available: true,
      rating: 4.9,
    },
    {
      name: "Veg Biryani",
      description: "Fragrant basmati rice with seasonal vegetables and aromatic spices",
      price: 160,
      category: biryani,
      image: "https://images.unsplash.com/photo-1596797038530-2c107229654b?w=400",
      ingredients: ["Basmati Rice", "Mixed Vegetables", "Mint", "Saffron", "Spices"],
      available: true,
      rating: 4.3,
    },
    {
      name: "Chicken Burger",
      description: "Crispy fried chicken fillet in a toasted brioche bun with special sauce",
      price: 149,
      category: burger,
      image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400",
      ingredients: ["Chicken Fillet", "Brioche Bun", "Lettuce", "Tomato", "Mayo", "Pickles"],
      available: true,
      rating: 4.6,
    },
    {
      name: "Veg Burger",
      description: "Spiced aloo tikki patty in a sesame bun with fresh veggies",
      price: 99,
      category: burger,
      image: "https://images.unsplash.com/photo-1520072959219-c595dc870360?w=400",
      ingredients: ["Aloo Tikki", "Sesame Bun", "Lettuce", "Tomato", "Green Chutney"],
      available: true,
      rating: 4.1,
    },
    {
      name: "Margherita Pizza",
      description: "Classic Italian pizza with tomato sauce, fresh mozzarella, and basil",
      price: 199,
      category: pizza,
      image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400",
      ingredients: ["Pizza Dough", "Tomato Sauce", "Mozzarella", "Basil", "Olive Oil"],
      available: true,
      rating: 4.5,
    },
    {
      name: "Chicken Pizza",
      description: "Loaded pizza with grilled chicken, bell peppers, and cheddar cheese",
      price: 249,
      category: pizza,
      image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400",
      ingredients: ["Pizza Dough", "Tomato Sauce", "Chicken", "Bell Peppers", "Cheddar", "Herbs"],
      available: true,
      rating: 4.7,
    },
    {
      name: "Veg Hakka Noodles",
      description: "Stir-fried noodles with crispy vegetables in Indo-Chinese sauces",
      price: 129,
      category: chinese,
      image: "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=400",
      ingredients: ["Noodles", "Cabbage", "Carrot", "Spring Onion", "Soy Sauce", "Vinegar"],
      available: true,
      rating: 4.2,
    },
    {
      name: "Chicken Fried Rice",
      description: "Wok-tossed rice with chicken, eggs, and vegetables in a savory sauce",
      price: 149,
      category: chinese,
      image: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400",
      ingredients: ["Rice", "Chicken", "Egg", "Spring Onion", "Soy Sauce", "Sesame Oil"],
      available: true,
      rating: 4.4,
    },
    {
      name: "Paneer Tikka",
      description: "Marinated paneer cubes grilled in a tandoor with peppers and onions",
      price: 179,
      category: snacks,
      image: "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=400",
      ingredients: ["Paneer", "Yogurt", "Bell Peppers", "Onion", "Tandoori Spices", "Lemon"],
      available: true,
      rating: 4.6,
    },
    {
      name: "French Fries",
      description: "Golden crispy fries seasoned with herbs and served with ketchup",
      price: 79,
      category: snacks,
      image: "https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=400",
      ingredients: ["Potato", "Salt", "Pepper", "Herbs", "Oil"],
      available: true,
      rating: 4.3,
    },
    {
      name: "Gulab Jamun",
      description: "Soft milk-solid dumplings soaked in rose-flavored sugar syrup",
      price: 69,
      category: dessert,
      image: "https://images.unsplash.com/photo-1601303516534-bf1a4b0e6d2e?w=400",
      ingredients: ["Milk Solids", "Sugar Syrup", "Rose Water", "Cardamom"],
      available: true,
      rating: 4.8,
    },
    {
      name: "Chocolate Brownie",
      description: "Rich, fudgy chocolate brownie with a scoop of vanilla ice cream",
      price: 119,
      category: dessert,
      image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400",
      ingredients: ["Dark Chocolate", "Butter", "Eggs", "Flour", "Sugar", "Vanilla Ice Cream"],
      available: true,
      rating: 4.7,
    },
    {
      name: "Coca-Cola",
      description: "Chilled Coca-Cola 300ml — the classic refresher",
      price: 40,
      category: drinks,
      image: "https://images.unsplash.com/photo-1629203851122-3726ecdf080e?w=400",
      ingredients: ["Carbonated Water", "Sugar", "Caramel Color", "Natural Flavors"],
      available: true,
      rating: 4.0,
    },
    {
      name: "Fresh Lime Soda",
      description: "Freshly squeezed lime with chilled soda water — sweet or salted",
      price: 49,
      category: drinks,
      image: "https://images.unsplash.com/photo-1544145945-f90425340c7e?w=400",
      ingredients: ["Lime Juice", "Soda Water", "Sugar/Salt", "Mint"],
      available: true,
      rating: 4.5,
    },
    {
      name: "Egg Biryani",
      description: "Boiled eggs layered with spiced basmati rice and caramelized onions",
      price: 180,
      category: biryani,
      image: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400",
      ingredients: ["Basmati Rice", "Boiled Eggs", "Caramelized Onion", "Saffron", "Spices"],
      available: true,
      rating: 4.4,
    },
    {
      name: "Paneer Pizza",
      description: "Pizza topped with spiced paneer, olives, and bell peppers",
      price: 229,
      category: pizza,
      image: "https://images.unsplash.com/photo-1594007654729-407eeec4be32?w=400",
      ingredients: ["Pizza Dough", "Tomato Sauce", "Paneer", "Olives", "Bell Peppers", "Cheese"],
      available: false, // Not available (for testing availability filter)
      rating: 4.2,
    },
    {
      name: "Mango Lassi",
      description: "Creamy yogurt blended with fresh Alphonso mango and a hint of cardamom",
      price: 79,
      category: drinks,
      image: "https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400",
      ingredients: ["Yogurt", "Mango Pulp", "Sugar", "Cardamom", "Rose Water"],
      available: true,
      rating: 4.7,
    },
  ];
};

const getUsers = async () => {
  const salt = await bcrypt.genSalt(10);
  return [
    {
      name: "Admin User",
      email: "admin@foodiehub.com",
      password: await bcrypt.hash("admin123", salt),
      phone: "9876543210",
      address: { street: "123 Admin Street", city: "Mumbai", state: "Maharashtra", pincode: "400001" },
      role: "admin",
    },
    {
      name: "Rahul Sharma",
      email: "rahul@example.com",
      password: await bcrypt.hash("password123", salt),
      phone: "9876543211",
      address: { street: "45 MG Road", city: "Bangalore", state: "Karnataka", pincode: "560001" },
      role: "customer",
    },
    {
      name: "Priya Patel",
      email: "priya@example.com",
      password: await bcrypt.hash("password123", salt),
      phone: "9876543212",
      address: { street: "78 Park Street", city: "Kolkata", state: "West Bengal", pincode: "700001" },
      role: "customer",
    },
    {
      name: "Arun Kumar",
      email: "arun@example.com",
      password: await bcrypt.hash("password123", salt),
      phone: "9876543213",
      address: { street: "12 Anna Nagar", city: "Chennai", state: "Tamil Nadu", pincode: "600040" },
      role: "customer",
    },
  ];
};

// ─── Seeder Function ──────────────────────────────────────────────────────────

const seedDatabase = async () => {
  // The seeder deletes every order, user, food and category. Never let it run against a
  // production database by accident (e.g. a copied .env).
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_IN_PRODUCTION !== "true") {
    console.error("❌ Refusing to seed: NODE_ENV=production. The seeder ERASES the database.");
    console.error("   Set ALLOW_SEED_IN_PRODUCTION=true if you really intend to wipe it.");
    process.exit(1);
  }

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected for seeding");

    // Clear existing data
    console.log("🗑️  Clearing existing data...");
    await Order.deleteMany({});
    await Cart.deleteMany({});
    await Food.deleteMany({});
    await Category.deleteMany({});
    await User.deleteMany({});

    // Seed Categories
    console.log("🌱 Seeding categories...");
    const insertedCategories = await Category.insertMany(categories);
    console.log(`   ✓ ${insertedCategories.length} categories inserted`);

    // Seed Foods (with actual category ObjectIds)
    console.log("🌱 Seeding foods...");
    const foods = getFoods(insertedCategories);
    const insertedFoods = await Food.insertMany(foods);
    console.log(`   ✓ ${insertedFoods.length} food items inserted`);

    // Seed Users (with pre-hashed passwords)
    console.log("🌱 Seeding users...");
    const users = await getUsers();
    // Use insertMany with pre-hashed passwords (bypass pre-save hook)
    const insertedUsers = await User.collection.insertMany(users);
    console.log(`   ✓ ${Object.keys(insertedUsers.insertedIds).length} users inserted`);

    console.log("\n✅ Database seeded successfully!");
    console.log("─────────────────────────────────────────");
    console.log("🔑 Admin Login Credentials:");
    console.log("   Email   : admin@foodiehub.com");
    console.log("   Password: admin123");
    console.log("─────────────────────────────────────────");
    console.log("👤 Customer Login Credentials:");
    console.log("   Email   : rahul@example.com");
    console.log("   Password: password123");
    console.log("─────────────────────────────────────────\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding Error:", error.message);
    process.exit(1);
  }
};

// Run the seeder
seedDatabase();
