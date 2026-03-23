import { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useParams, useNavigate, Navigate } from "react-router-dom";
import { 
  Search, 
  ChefHat, 
  Scale, 
  Thermometer, 
  Clock, 
  ArrowLeft, 
  Wifi, 
  WifiOff, 
  Info,
  Sparkles,
  Send,
  Loader2,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  ArrowRight,
  LogOut,
  LogIn,
  User as UserIcon,
  Sun,
  Moon,
  ChevronDown,
  Check
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import ReactMarkdown from "react-markdown";
import { GoogleGenAI } from "@google/genai";
import { auth, db } from "./firebase";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User 
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  getDocs, 
  getDoc, 
  doc, 
  query, 
  where,
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  Timestamp,
  setDoc,
  deleteDoc
} from "firebase/firestore";

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Firestore Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Theme Context ---
type Theme = "dark" | "light";
const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({ theme: "dark", toggleTheme: () => {} });

const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("recipe-vault-theme");
    return (saved as Theme) || "dark";
  });

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("recipe-vault-theme", next);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

const useTheme = () => useContext(ThemeContext);

// --- Auth Context ---
interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, isAdmin: false });

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Check if user is admin (hardcoded for now or fetch from Firestore)
        const adminEmail = "fatsogee8@gmail.com";
        setIsAdmin(user.email === adminEmail);
        
        // Sync user profile to Firestore
        const userRef = doc(db, "users", user.uid);
        try {
          await setDoc(userRef, {
            displayName: user.displayName || "Anonymous Operator",
            email: user.email,
            role: user.email === adminEmail ? "admin" : "user"
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
        }
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => useContext(AuthContext);

// --- Types ---
interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  type?: 'raw' | 'batch_recipe';
  batchFraction?: number;
}

interface FoodSafety {
  min_temp: number;
  hold_time: number;
  hold_time_minutes: number;
}

interface Recipe {
  id: string;
  name: string;
  description?: string;
  base_yield_quantity: number;
  base_yield_unit: string;
  station_assignment: string;
  food_safety_metadata: FoodSafety;
  ingredients: Ingredient[];
  steps: string[];
  tags: string[];
  private_notes?: string;
  authorUid: string;
  createdAt: Timestamp;
  type: 'menu' | 'batch';
  batchYield?: number;
  batchYieldUnit?: 'g' | 'kg' | 'ml' | 'L' | 'count';
  storage?: 'fridge' | 'ambient' | 'freezer';
}

// --- Components ---

const Header = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { user, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleOutsideClick = () => {
      setIsDropdownOpen(false);
    };
    window.addEventListener('click', handleOutsideClick);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('click', handleOutsideClick);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('Install outcome:', outcome);
    setDeferredPrompt(null);
  };

  const handleLogout = () => signOut(auth);

  if (!user) return null;

  const getInitials = (name: string | null) => {
    if (!name) return "??";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const firstName = user.displayName?.split(" ")[0] || "User";

  return (
    <header className="app-header">
      {/* Row 1 — identity */}
      <div className="header-row-1">
        <Link to="/" className="header-identity">
          <div className="header-logo">
            <ChefHat className="w-5 h-5" />
          </div>
          <div className="header-name-block">
            <h1 className="header-title uppercase">Recipe Vault</h1>
          </div>
        </Link>

        <div className="relative">
          <button 
            className="user-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setIsDropdownOpen(!isDropdownOpen);
            }}
            aria-expanded={isDropdownOpen}
          >
            <div className="user-avatar">{getInitials(user.displayName)}</div>
            <span className="user-trigger-name">{firstName}</span>
            <ChevronDown className="user-trigger-chevron w-3 h-3" />
          </button>

          <div className={cn("user-dropdown", isDropdownOpen && "open")}>
            <div className="dropdown-user-info">
              <div className="dropdown-user-name">{user.displayName}</div>
              <div className="dropdown-user-role uppercase">{isAdmin ? "ADMIN" : "OPERATOR"}</div>
            </div>

            <button 
              className="dropdown-item"
              onClick={() => {
                if (theme !== "dark") toggleTheme();
              }}
            >
              <span className="dropdown-item-icon">🌙</span>
              <span>DARK MODE</span>
              {theme === "dark" && <Check className="ml-auto w-3 h-3 text-green" />}
            </button>

            <button 
              className="dropdown-item"
              onClick={() => {
                if (theme !== "light") toggleTheme();
              }}
            >
              <span className="dropdown-item-icon">☀️</span>
              <span>LIGHT MODE</span>
              {theme === "light" && <Check className="ml-auto w-3 h-3 text-green" />}
            </button>

            <div className="h-[1px] bg-border my-1.5 mx-2.5" />

            <button onClick={handleLogout} className="dropdown-item danger">
              <span className="dropdown-item-icon">↗</span>
              <span>LOGOUT</span>
            </button>
          </div>
        </div>
      </div>

      {/* Row 2 — actions */}
      <div className="header-row-2">
        <div className="flex items-center gap-3">
          {deferredPrompt && (
            <button 
              onClick={handleInstallClick}
              className="status-pill uppercase hover:bg-green/20 transition-colors"
            >
              ↓ INSTALL
            </button>
          )}
          <div className="status-pill uppercase">
            <div className={cn("status-dot", !isOnline && "bg-red-500 shadow-[0_0_6px_#ef4444] animate-none")} />
            <span>{isOnline ? "Online" : "Offline Mode"}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

const RecipeCard = ({ recipe }: { recipe: Recipe }) => {
  const formatHoldTime = (hours: number, minutes: number) => {
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  };

  const isBatch = recipe.type === 'batch';

  return (
    <div className={cn("recipe-card group", isBatch && "batch-type")}>
      <div className="recipe-card-accent absolute left-0 top-0 bottom-0 w-[3px] bg-green" />
      <div className="p-[18px] pl-[22px]">
        <div className="flex justify-between items-start mb-3">
          <div className="flex flex-wrap gap-2">
            <span className="station-tag text-text-2 border border-border-hi rounded bg-elevated">
              {recipe.station_assignment}
            </span>
            {isBatch && (
              <span className="batch-type-badge">
                <span>⚙</span> BATCH
              </span>
            )}
            {recipe.tags?.map(tag => (
              <span key={tag} className="badge text-green/70 border border-green/20 rounded bg-green/5 px-1.5 py-0.5">
                {tag}
              </span>
            ))}
          </div>
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-1 font-mono text-[9px]">
              <Thermometer className="w-3 h-3 text-amber" />
              <span className="text-amber">{recipe.food_safety_metadata.min_temp}°</span>
            </div>
            <div className="flex items-center gap-1 font-mono text-[9px] whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 text-text-2" />
              <span className="text-text-2">
                {formatHoldTime(recipe.food_safety_metadata.hold_time, recipe.food_safety_metadata.hold_time_minutes)}
              </span>
            </div>
          </div>
        </div>
        <h3 className="recipe-card-name font-body text-text-1 mb-2 transition-colors group-hover:text-green">{recipe.name}</h3>
        <div className="flex items-center justify-between">
          <div className="recipe-card-bottom uppercase">
            {isBatch ? (
              <span className="recipe-card-yield">Yield: {recipe.batchYield} {recipe.batchYieldUnit} batch</span>
            ) : (
              <span className="recipe-card-yield">Yield: {recipe.base_yield_quantity} {recipe.base_yield_unit}</span>
            )}
            <span className="recipe-card-ingredients">{recipe.ingredients.length} Ingredients</span>
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
            <span className="text-[10px] font-mono text-green uppercase tracking-[0.1em] font-bold flex items-center gap-1.5">
              View Details <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>
        <Link to={`/recipe/${recipe.id}`} className="absolute inset-0 z-10" />
      </div>
    </div>
  );
};

const QuickAISearch = () => {
  const [queryText, setQueryText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = () => {
    if (internalRef.current) {
      internalRef.current.style.height = 'auto';
      internalRef.current.style.height = Math.min(internalRef.current.scrollHeight, 120) + 'px';
    }
  };

  useEffect(() => {
    autoResize();
  }, [queryText]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!queryText.trim() || loading) return;

    const currentQuery = queryText;
    setQueryText("");
    if (internalRef.current) {
      internalRef.current.style.height = '44px';
    }

    setLoading(true);
    setResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      // 1. Fetch recipes from Firestore for context
      const snapshot = await getDocs(collection(db, "recipes"));
      const recipes = snapshot.docs.map(doc => doc.data());

      const contextStr = recipes.map((r: any) => 
        `Recipe: ${r.name}\nOrigin/Notes: ${r.description || "N/A"}\nStation: ${r.station_assignment}\nTags: ${r.tags?.join(", ") || "None"}\nBase Yield: ${r.base_yield_quantity} ${r.base_yield_unit}\nIngredients:\n${r.ingredients.map((i: any) => `- ${i.name}: ${i.quantity} ${i.unit}`).join("\n")}\nSteps:\n${r.steps.map((s: any, idx: number) => `${idx + 1}. ${s}`).join("\n")}\nFood Safety: Min Temp ${r.food_safety_metadata.min_temp}°F, Hold Time ${r.food_safety_metadata.hold_time}h ${r.food_safety_metadata.hold_time_minutes}m`
      ).join("\n\n---\n\n");

      const prompt = `
        You are the Franchise Recipe Vault Assistant. 
        Use the following retrieved recipe context to answer the user's question.
        If the information is not in the context, say you don't know.
        Cite the recipe names in your response.
        Keep it concise and professional.
        
        FORMATTING INSTRUCTIONS:
        - Use bullet points (-) for lists of ingredients.
        - Use numbered lists (1.) for step-by-step instructions.
        - Use bold text for recipe names and key terms.
        
        CONTEXT:
        ${contextStr}
        
        USER QUESTION:
        ${currentQuery}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      setResult(response.text || "No response generated.");
    } catch (err) {
      console.error(err);
      setResult("Error processing request. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="ai-search-container">
      <div className="ai-search-header">
        <div className="ai-search-icon">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <h3 className="vault-assistant-title">Vault Assistant</h3>
          <p className="vault-assistant-sub">Semantic Recipe Retrieval</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="ai-input-row">
        <textarea 
          ref={internalRef}
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about prep, stations, or ingredients"
          className="ai-input"
          rows={1}
        />
        <button 
          type="submit" 
          disabled={loading}
          className="btn-ask-ai"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>{loading ? "SEARCHING..." : "ASK AI"}</span>
        </button>
      </form>

      <AnimatePresence>
        {result && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="ai-result-box"
          >
            <div className="ai-result-content markdown-body">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
            <div className="ai-result-footer">
              <span className="ai-result-tag">Generated by Vault AI</span>
              <button 
                onClick={() => setResult(null)}
                className="text-[9px] font-mono text-text-3 hover:text-text-2 uppercase tracking-widest"
              >
                Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const RecipeList = () => {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const { user } = useAuth();

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    recipes.forEach(r => r.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    if (!selectedTag) return recipes;
    return recipes.filter(r => r.tags?.includes(selectedTag));
  }, [recipes, selectedTag]);

  useEffect(() => {
    const q = query(collection(db, "recipes"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const recipeData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Recipe[];
      setRecipes(recipeData);
      setLoading(false);

      // Seed if empty
      if (recipeData.length === 0 && user) {
        const seedData = [
          {
            name: "Classic Smash Burger",
            description: "A diner-style classic with a crispy crust and juicy center. Perfected over years of backyard grilling.",
            base_yield_quantity: 1,
            base_yield_unit: "burger",
            station_assignment: "Grill",
            food_safety_metadata: { min_temp: 160, hold_time: 2, hold_time_minutes: 0 },
            ingredients: [
              { id: "i1", name: "Beef Patty (80/20)", quantity: 150, unit: "g" },
              { id: "i2", name: "Brioche Bun", quantity: 1, unit: "count" },
              { id: "i3", name: "American Cheese", quantity: 1, unit: "slice" }
            ],
            steps: ["Preheat grill to 450F", "Smash patty for 10 seconds", "Cook until 160F internal"],
            tags: ["Main Course", "Signature"],
            private_notes: "Use the heavy press for better crust.",
            authorUid: user.uid,
            createdAt: serverTimestamp(),
            type: 'menu'
          },
          {
            name: "Truffle Fries",
            description: "Elevated comfort food. These fries are tossed in premium truffle oil and aged parmesan.",
            base_yield_quantity: 1,
            base_yield_unit: "order",
            station_assignment: "Fryer",
            food_safety_metadata: { min_temp: 140, hold_time: 4, hold_time_minutes: 0 },
            ingredients: [
              { id: "i4", name: "Russet Fries", quantity: 200, unit: "g" },
              { id: "i5", name: "Truffle Oil", quantity: 5, unit: "ml" },
              { id: "i6", name: "Parmesan", quantity: 10, unit: "g" }
            ],
            steps: ["Fry at 350F for 3.5 mins", "Toss with oil and cheese immediately"],
            tags: ["Appetizer", "Vegetarian"],
            private_notes: "Don't over-oil or they get soggy.",
            authorUid: user.uid,
            createdAt: serverTimestamp(),
            type: 'menu'
          }
        ];
        seedData.forEach(async (recipe) => {
          try {
            await addDoc(collection(db, "recipes"), recipe);
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, "recipes");
          }
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "recipes");
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-green" /></div>;

  return (
    <div className="page-container max-w-7xl mx-auto px-5 pb-12 w-full box-sizing-border-box overflow-x-hidden">
      {/* AI Search Integration */}
      <QuickAISearch />

      {/* Row 2: Meta Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between w-full mb-8 gap-4">
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={() => setSelectedTag(null)}
            className={cn(
              "filter-pill rounded-lg transition-all border",
              !selectedTag ? "bg-green border-green text-white" : "bg-surface border-border text-text-3 hover:border-border-hi"
            )}
          >
            All
          </button>
          {allTags.map(tag => (
            <button 
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={cn(
                "filter-pill rounded-lg transition-all border",
                selectedTag === tag ? "bg-green border-green text-white" : "bg-surface border-border text-text-3 hover:border-border-hi"
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Row 3: Action Row */}
      <div className="w-full mb-6">
        <Link 
          to="/add" 
          className="btn-new-recipe inline-flex items-center gap-[6px] bg-green hover:bg-green/80 text-black rounded-lg transition-all whitespace-nowrap border-none cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>NEW RECIPE</span>
        </Link>
      </div>

      {/* Divider */}
      <div className="border-b border-border w-full mb-8" />

      {/* Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
        {filteredRecipes.map(recipe => (
          <RecipeCard key={recipe.id} recipe={recipe} />
        ))}
        {filteredRecipes.length === 0 && (
          <div className="col-span-full py-20 text-center border border-dashed border-border rounded-2xl">
            <ChefHat className="w-12 h-12 text-text-3 mx-auto mb-4 opacity-20" />
            <p className="text-text-3 font-mono text-xs uppercase tracking-widest">No recipes found in the vault.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const RecipeForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [formData, setFormData] = useState<Omit<Recipe, "id" | "createdAt" | "authorUid">>({
    name: "",
    description: "",
    base_yield_quantity: 1,
    base_yield_unit: "order",
    station_assignment: "Grill",
    food_safety_metadata: { min_temp: 165, hold_time: 4, hold_time_minutes: 0 },
    ingredients: [],
    steps: [""],
    tags: [],
    private_notes: "",
    type: 'menu',
    batchYield: 1000,
    batchYieldUnit: 'g',
    storage: 'fridge'
  });

  useEffect(() => {
    if (id) {
      const fetchRecipe = async () => {
        setFetching(true);
        try {
          const docRef = doc(db, "recipes", id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data() as Recipe;
            setFormData({
              name: data.name,
              description: data.description || "",
              base_yield_quantity: data.base_yield_quantity,
              base_yield_unit: data.base_yield_unit,
              station_assignment: data.station_assignment,
              food_safety_metadata: {
                min_temp: data.food_safety_metadata.min_temp,
                hold_time: data.food_safety_metadata.hold_time,
                hold_time_minutes: data.food_safety_metadata.hold_time_minutes || 0
              },
              ingredients: data.ingredients,
              steps: data.steps,
              tags: data.tags || [],
              private_notes: data.private_notes || "",
              type: data.type || 'menu',
              batchYield: data.batchYield || 1000,
              batchYieldUnit: data.batchYieldUnit || 'g',
              storage: data.storage || 'fridge'
            });
          }
        } catch (err) {
          console.error("Error fetching recipe:", err);
        } finally {
          setFetching(false);
        }
      };
      fetchRecipe();
    }
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      if (id) {
        // Update existing
        await setDoc(doc(db, "recipes", id), {
          ...formData,
          authorUid: user.uid, 
        }, { merge: true });
      } else {
        // Create new
        await addDoc(collection(db, "recipes"), {
          ...formData,
          authorUid: user.uid,
          createdAt: serverTimestamp()
        });
      }
      navigate(id ? `/recipe/${id}` : "/");
    } catch (err) {
      handleFirestoreError(err, id ? OperationType.UPDATE : OperationType.CREATE, `recipes/${id || ''}`);
    } finally {
      setLoading(false);
    }
  };

  const [allRecipes, setAllRecipes] = useState<Recipe[]>([]);
  const [selectedBatchRecipe, setSelectedBatchRecipe] = useState<Recipe | null>(null);
  const [newIngName, setNewIngName] = useState("");
  const [newIngQty, setNewIngQty] = useState(0);
  const [newIngUnit, setNewIngUnit] = useState("g");
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    const fetchBatchRecipes = async () => {
      const q = query(collection(db, 'recipes'), where('type', '==', 'batch'));
      const snapshot = await getDocs(q);
      setAllRecipes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Recipe)));
    };
    fetchBatchRecipes();
  }, []);

  const calcBatchFraction = (usedQty: number, usedUnit: string, bYield: number, bUnit: string) => {
    const normalise = (qty: number, unit: string) => {
      if (unit === 'kg') return qty * 1000;
      if (unit === 'L') return qty * 1000;
      return qty; // g, ml, count already base
    };

    const usedNorm = normalise(usedQty, usedUnit);
    const batchNorm = normalise(bYield, bUnit);
    const fraction = usedNorm / batchNorm;

    return {
      fraction: fraction,
      fractionFormatted: fraction.toFixed(3),
      fractionReadable: `${(fraction * 100).toFixed(1)}%`,
    };
  };

  const addIngredient = () => {
    if (!newIngName) return;
    
    const newIng: Ingredient = {
      id: selectedBatchRecipe ? selectedBatchRecipe.id : Math.random().toString(36).substr(2, 9),
      name: newIngName,
      quantity: newIngQty,
      unit: newIngUnit,
      type: selectedBatchRecipe ? 'batch_recipe' : 'raw'
    };

    if (selectedBatchRecipe) {
      const calc = calcBatchFraction(newIngQty, newIngUnit, selectedBatchRecipe.batchYield || 1, selectedBatchRecipe.batchYieldUnit || 'g');
      newIng.batchFraction = calc.fraction;
    }

    setFormData(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, newIng]
    }));
    setNewIngName("");
    setNewIngQty(0);
    setNewIngUnit("g");
    setSelectedBatchRecipe(null);
  };

  const removeIngredient = (ingId: string) => {
    setFormData(prev => ({
      ...prev,
      ingredients: prev.ingredients.filter(ing => ing.id !== ingId)
    }));
  };

  const addStep = () => {
    setFormData(prev => ({
      ...prev,
      steps: [...prev.steps, ""]
    }));
  };

  const removeStep = (idx: number) => {
    setFormData(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== idx)
    }));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 w-full box-sizing-border-box">
      <Link to="/" className="inline-flex items-center gap-2 text-text-3 hover:text-text-1 mb-8 transition-colors font-mono text-xs uppercase tracking-widest">
        <ArrowLeft className="w-4 h-4" />
        Cancel Entry
      </Link>

      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl w-full box-sizing-border-box">
        <div className="p-8 border-b border-border bg-elevated/50">
          <h2 className="text-3xl font-extrabold tracking-tight text-text-1 font-display uppercase mb-2">
            {id ? "Edit Recipe" : "Recipe Intake"}
          </h2>
          <p className="text-text-3 font-mono text-xs uppercase tracking-widest">
            {id ? "Update Operational Standard" : "Controlled Operational Standard Entry"}
          </p>
        </div>

        {fetching ? (
          <div className="p-20 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-green" />
          </div>
        ) : (
          <>
            <div className="p-8 space-y-10">
          {/* Recipe Type Selector */}
          <div className="recipe-type-selector">
            <button
              type="button"
              className={cn("recipe-type-btn", formData.type === 'menu' && "active")}
              onClick={() => setFormData(prev => ({ ...prev, type: 'menu' }))}
            >
              MENU RECIPE
            </button>
            <button
              type="button"
              className={cn("recipe-type-btn", formData.type === 'batch' && "active")}
              onClick={() => setFormData(prev => ({ ...prev, type: 'batch' }))}
            >
              BATCH RECIPE
            </button>
          </div>

          {/* Basic Info */}
          <section className="space-y-6">
            <h4 className="text-[10px] font-mono text-text-3 uppercase tracking-[0.2em] border-b border-border pb-2">01. Identity & Yield</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="form-field-label">RECIPE NAME</label>
                <input 
                  required
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Signature Smash Burger"
                  className="w-full bg-base border border-border rounded-lg px-4 py-3 text-text-1 font-body focus:border-green transition-colors outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="form-field-label">Base Yield</label>
                  <input 
                    required
                    type="number" 
                    value={formData.base_yield_quantity}
                    onChange={e => setFormData(prev => ({ ...prev, base_yield_quantity: Number(e.target.value) }))}
                    className="w-full bg-base border border-border rounded-lg px-4 py-3 text-text-1 font-mono focus:border-green transition-colors outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="form-field-label">Unit</label>
                  <input 
                    required
                    type="text" 
                    value={formData.base_yield_unit}
                    onChange={e => setFormData(prev => ({ ...prev, base_yield_unit: e.target.value }))}
                    placeholder="order"
                    className="w-full bg-base border border-border rounded-lg px-4 py-3 text-text-1 font-mono focus:border-green transition-colors outline-none"
                  />
                </div>
              </div>
            </div>

            {formData.type === 'batch' && (
              <div className="space-y-6 pt-4 border-t border-border">
                <div className="space-y-2">
                  <label className="form-field-label">BATCH YIELD</label>
                  <div className="batch-yield-row">
                    <input
                      type="number"
                      value={formData.batchYield}
                      onChange={(e) => setFormData(prev => ({ ...prev, batchYield: Number(e.target.value) }))}
                      className="batch-yield-input"
                      placeholder="2000"
                    />
                    <select
                      value={formData.batchYieldUnit}
                      onChange={(e) => setFormData(prev => ({ ...prev, batchYieldUnit: e.target.value as any }))}
                      className="batch-unit-select"
                    >
                      <option value="g">g</option>
                      <option value="kg">kg</option>
                      <option value="ml">ml</option>
                      <option value="L">L</option>
                      <option value="count">count</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="form-field-label">STORAGE</label>
                  <div className="storage-options">
                    {[
                      { id: 'fridge', label: 'FRIDGE', icon: '❄️' },
                      { id: 'ambient', label: 'AMBIENT', icon: '🌡️' },
                      { id: 'freezer', label: 'FREEZER', icon: '🧊' }
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, storage: opt.id as any }))}
                        className={cn(
                          "storage-option",
                          formData.storage === opt.id && "selected batch-amber"
                        )}
                      >
                        <span className="storage-icon">{opt.icon}</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="form-field-label">Recipe Story & Origin (Public)</label>
              <textarea 
                rows={2}
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Where did this recipe come from? Any special history or creator notes?"
                className="w-full bg-base border border-border rounded-lg px-4 py-3 text-sm text-text-2 font-body focus:border-green outline-none resize-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[9px] font-mono text-text-3 uppercase tracking-widest">Station Assignment</label>
                <select 
                  value={formData.station_assignment}
                  onChange={e => setFormData(prev => ({ ...prev, station_assignment: e.target.value }))}
                  className="w-full bg-base border border-border rounded-lg px-4 py-3 text-text-1 font-mono focus:border-green transition-colors outline-none appearance-none"
                >
                  <option value="Grill">Grill</option>
                  <option value="Fryer">Fryer</option>
                  <option value="Prep">Prep</option>
                  <option value="Sauté">Sauté</option>
                  <option value="Cold Line">Cold Line</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-mono text-text-3 uppercase tracking-widest">Min Internal Temp (°F)</label>
                <input 
                  required
                  type="number" 
                  value={formData.food_safety_metadata.min_temp}
                  onChange={e => setFormData(prev => ({ ...prev, food_safety_metadata: { ...prev.food_safety_metadata, min_temp: Number(e.target.value) } }))}
                  className="w-full bg-base border border-border rounded-lg px-4 py-3 text-amber font-mono focus:border-amber transition-colors outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-mono text-text-3 uppercase tracking-widest">Hold Time</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <input 
                      required
                      type="number" 
                      min="0"
                      value={formData.food_safety_metadata.hold_time}
                      onChange={e => setFormData(prev => ({ ...prev, food_safety_metadata: { ...prev.food_safety_metadata, hold_time: Number(e.target.value) } }))}
                      className="w-full bg-base border border-border rounded-lg pl-4 pr-8 py-3 text-text-2 font-mono focus:border-green transition-colors outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-text-3 pointer-events-none">H</span>
                  </div>
                  <div className="relative">
                    <input 
                      required
                      type="number" 
                      min="0"
                      max="59"
                      value={formData.food_safety_metadata.hold_time_minutes}
                      onChange={e => setFormData(prev => ({ ...prev, food_safety_metadata: { ...prev.food_safety_metadata, hold_time_minutes: Number(e.target.value) } }))}
                      className="w-full bg-base border border-border rounded-lg pl-4 pr-8 py-3 text-text-2 font-mono focus:border-green transition-colors outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-text-3 pointer-events-none">M</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Ingredients */}
          <section className="space-y-6">
            <div className="flex justify-between items-end border-b border-border pb-2">
              <h4 className="text-[10px] font-mono text-text-3 uppercase tracking-[0.2em]">02. Ingredient Registry</h4>
            </div>
            <div className="space-y-3">
              {formData.ingredients.map((ing, idx) => (
                <div key={ing.id} className="flex items-center justify-between bg-base border border-border rounded-xl p-4 group">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-body text-[15px] text-text-1">{ing.name}</span>
                      {ing.type === 'batch_recipe' && <span className="text-[9px] font-mono text-amber border border-amber/20 bg-amber/5 px-1.5 py-0.5 rounded">BATCH</span>}
                    </div>
                    <div className="text-text-3 font-mono text-[11px] mt-0.5">
                      {ing.quantity}{ing.unit}
                      {ing.batchFraction !== undefined && (
                        <span className="ml-2 text-amber">· {(ing.batchFraction * 100).toFixed(1)}% of batch</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeIngredient(ing.id)}
                    className="p-2 text-text-3 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="bg-elevated/50 border border-dashed border-border rounded-2xl p-6 space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="form-field-label">ADD INGREDIENT</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={newIngName}
                      onChange={(e) => {
                        setNewIngName(e.target.value);
                        setSelectedBatchRecipe(null);
                        setShowDropdown(true);
                      }}
                      onFocus={() => setShowDropdown(true)}
                      className="w-full bg-base border border-border rounded-lg px-4 py-3 text-text-1 focus:outline-none focus:border-green-dim transition-colors font-body text-[15px]"
                      placeholder="Search or type ingredient..."
                    />
                    {newIngName && showDropdown && !selectedBatchRecipe && (
                      <div className="absolute z-50 left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-2xl max-h-[300px] overflow-y-auto p-2">
                        <div className="ingredient-picker-section">RAW INGREDIENTS</div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowDropdown(false);
                          }}
                          className="w-full text-left p-3 hover:bg-elevated rounded-lg font-body text-[14px] text-text-1"
                        >
                          Add "{newIngName}" as raw ingredient
                        </button>

                        {allRecipes.length > 0 && (
                          <>
                            <div className="ingredient-picker-section">BATCH RECIPES</div>
                            {allRecipes
                              .filter(r => r.name.toLowerCase().includes(newIngName.toLowerCase()))
                              .map(r => (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => {
                                    setNewIngName(r.name);
                                    setSelectedBatchRecipe(r);
                                    setNewIngUnit(r.batchYieldUnit || 'g');
                                    setShowDropdown(false);
                                  }}
                                  className="w-full text-left p-3 hover:bg-elevated rounded-lg border-l-2 border-transparent hover:border-amber transition-all group"
                                >
                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                      <span className="text-amber">⚙</span>
                                      <span className="font-body text-[14px] text-text-1">{r.name}</span>
                                    </div>
                                    <span className="text-[10px] font-mono text-text-3">{r.batchYield}{r.batchYieldUnit} batch</span>
                                  </div>
                                </button>
                              ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="form-field-label">QUANTITY</label>
                    <input
                      type="number"
                      value={newIngQty}
                      onChange={(e) => setNewIngQty(Number(e.target.value))}
                      className="w-full bg-base border border-border rounded-lg px-4 py-3 text-text-1 focus:outline-none focus:border-green-dim transition-colors font-mono text-[16px] font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="form-field-label">UNIT</label>
                    <input
                      type="text"
                      value={newIngUnit}
                      onChange={(e) => setNewIngUnit(e.target.value)}
                      className="w-full bg-base border border-border rounded-lg px-4 py-3 text-text-1 focus:outline-none focus:border-green-dim transition-colors font-mono text-[12px]"
                      placeholder="g"
                    />
                  </div>
                </div>

                {selectedBatchRecipe && (
                  <div className="batch-fraction-display">
                    FROM BATCH: {calcBatchFraction(newIngQty, newIngUnit, selectedBatchRecipe.batchYield || 1, selectedBatchRecipe.batchYieldUnit || 'g').fractionFormatted} of batch · {calcBatchFraction(newIngQty, newIngUnit, selectedBatchRecipe.batchYield || 1, selectedBatchRecipe.batchYieldUnit || 'g').fractionReadable} of {selectedBatchRecipe.batchYield}{selectedBatchRecipe.batchYieldUnit}
                  </div>
                )}

                <button
                  type="button"
                  onClick={addIngredient}
                  disabled={!newIngName || newIngQty <= 0}
                  className="w-full bg-text-1 text-base py-3 rounded-xl font-mono text-[11px] font-bold uppercase tracking-widest hover:bg-green hover:text-white transition-all disabled:opacity-50 disabled:hover:bg-text-1 disabled:hover:text-base"
                >
                  Confirm Ingredient
                </button>
              </div>
            </div>
          </section>

          {/* Steps */}
          <section className="space-y-6">
            <div className="flex justify-between items-end border-b border-border pb-2">
              <h4 className="text-[10px] font-mono text-text-3 uppercase tracking-[0.2em]">03. Preparation Protocol</h4>
              <button 
                type="button"
                onClick={addStep}
                className="flex items-center gap-1 text-[9px] font-mono text-green hover:text-green/80 uppercase tracking-widest transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Step
              </button>
            </div>
            <div className="space-y-4">
              {formData.steps.map((step, idx) => (
                <div key={idx} className="flex gap-4 items-start animate-in fade-in slide-in-from-left-2 duration-200">
                  <span className="font-mono text-[10px] text-text-3 w-[18px] mt-3">0{idx + 1}</span>
                  <textarea 
                    required
                    rows={2}
                    value={step}
                    onChange={e => {
                      const newSteps = [...formData.steps];
                      newSteps[idx] = e.target.value;
                      setFormData(prev => ({ ...prev, steps: newSteps }));
                    }}
                    placeholder="Describe step instructions..."
                    className="flex-1 bg-base border border-border rounded-lg px-4 py-2 text-sm text-text-1 font-body focus:border-green outline-none resize-none"
                  />
                  {formData.steps.length > 1 && (
                    <button 
                      type="button"
                      onClick={() => removeStep(idx)}
                      className="p-2 text-text-3 hover:text-red-500 transition-colors mt-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Private Notes */}
          <section className="space-y-4">
            <h4 className="text-[10px] font-mono text-text-3 uppercase tracking-[0.2em] border-b border-border pb-2">04. Categorization Tags</h4>
            <div className="flex flex-wrap gap-2 mb-4">
              {formData.tags.map(tag => (
                <span key={tag} className="flex items-center gap-1.5 px-3 py-1.5 bg-green/10 border border-green/20 rounded-lg text-green font-mono text-[10px] uppercase tracking-widest">
                  {tag}
                  <button 
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }))}
                    className="hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input 
                type="text"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
                      setFormData(prev => ({ ...prev, tags: [...prev.tags, newTag.trim()] }));
                      setNewTag("");
                    }
                  }
                }}
                placeholder="Add a tag (e.g. Main Course, Vegan)..."
                className="flex-1 bg-base border border-border rounded-lg px-4 py-3 text-sm text-text-1 font-body focus:border-green outline-none"
              />
              <button 
                type="button"
                onClick={() => {
                  if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
                    setFormData(prev => ({ ...prev, tags: [...prev.tags, newTag.trim()] }));
                    setNewTag("");
                  }
                }}
                className="px-4 bg-elevated border border-border rounded-lg text-text-2 hover:text-text-1 transition-colors font-mono text-[10px] uppercase tracking-widest"
              >
                Add
              </button>
            </div>
          </section>

          {/* Private Notes */}
          <section className="space-y-4">
            <h4 className="text-[10px] font-mono text-amber uppercase tracking-[0.2em] border-b border-amber/20 pb-2">05. Managerial Notes (Private)</h4>
            <textarea 
              rows={3}
              value={formData.private_notes}
              onChange={e => setFormData(prev => ({ ...prev, private_notes: e.target.value }))}
              placeholder="Internal cost notes, secret tips, or franchise-only commentary..."
              className="w-full bg-amber/5 border border-amber/20 rounded-lg px-4 py-3 text-sm text-text-2 font-body focus:border-amber outline-none resize-none"
            />
          </section>
        </div>

        <div className="p-8 border-t border-border bg-elevated/50 flex justify-end">
          <button 
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-green hover:bg-green/80 text-white px-8 py-3 rounded-xl font-mono text-sm uppercase tracking-widest transition-all shadow-lg shadow-green/10 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>{id ? "Save Changes" : "Publish to Vault"}</span>
          </button>
        </div>
          </>
        )}
      </form>
    </div>
  );
};

const RecipeDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [yieldMultiplier, setYieldMultiplier] = useState(1);
  const [scalingMode, setScalingMode] = useState<"portion" | "batch">("portion");
  const [loading, setLoading] = useState(true);
  const { user, isAdmin } = useAuth();

  const handleDelete = async () => {
    if (!id || !window.confirm("Are you sure you want to delete this recipe?")) return;
    try {
      await deleteDoc(doc(db, "recipes", id));
      navigate("/");
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `recipes/${id}`);
    }
  };

  useEffect(() => {
    if (!id) return;
    const recipeRef = doc(db, "recipes", id);
    const unsubscribe = onSnapshot(recipeRef, (snapshot) => {
      if (snapshot.exists()) {
        setRecipe({ id: snapshot.id, ...snapshot.data() } as Recipe);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `recipes/${id}`);
    });
    return unsubscribe;
  }, [id]);

  const formatHoldTime = (hours: number, minutes: number) => {
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-green" /></div>;
  if (!recipe) return <div>Recipe not found</div>;

  const canSeePrivateNotes = isAdmin || recipe.authorUid === user?.uid;
  const isBatch = recipe.type === 'batch';

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 w-full box-sizing-border-box">
      <Link to="/" className="back-nav inline-flex items-center gap-2 text-text-3 hover:text-text-1 mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Vault
      </Link>

      <div className={cn("bg-surface border border-border rounded-2xl overflow-hidden w-full box-sizing-border-box", isBatch && "border-amber/30 shadow-amber/5")}>
        <div className={cn("detail-header", isBatch && "bg-amber/5")}>
          {/* Row 1 */}
          <div className="detail-header-top">
            <div className="flex items-center gap-3">
              <span className="detail-station-tag">{recipe.station_assignment} Station</span>
              {isBatch && (
                <span className="batch-type-badge">
                  <span>⚙</span> BATCH
                </span>
              )}
            </div>
            <div className="safety-block">
              <p className="safety-label">Safety Standard</p>
              <div className="safety-badges">
                <div className="safety-badge temp">
                  <Thermometer className="w-3.5 h-3.5" />
                  <span>{recipe.food_safety_metadata.min_temp}°F</span>
                </div>
                <div className="safety-badge time">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{formatHoldTime(recipe.food_safety_metadata.hold_time, recipe.food_safety_metadata.hold_time_minutes)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2 */}
          <h2 className="detail-title">{recipe.name}</h2>
          {recipe.description && (
            <p className="text-text-2 font-body text-sm italic mb-6 px-5 opacity-80 leading-relaxed">
              "{recipe.description}"
            </p>
          )}

          {/* Row 3 */}
          <div className="detail-actions">
            {canSeePrivateNotes && (
              <>
                <Link to={`/edit/${recipe.id}`} className="action-btn edit">
                  <Edit3 className="w-3.5 h-3.5" />
                  EDIT RECIPE
                </Link>
                <button onClick={handleDelete} className="action-btn delete">
                  <Trash2 className="w-3.5 h-3.5" />
                  DELETE RECIPE
                </button>
              </>
            )}
          </div>

          {/* Row 4 */}
          <div className="p-5 border-t border-border bg-elevated/20">
            <div className="scaler-tabs">
              <button 
                onClick={() => {
                  setScalingMode("portion");
                  setYieldMultiplier(1);
                }}
                className={cn("scaler-tab", scalingMode === "portion" && "active")}
              >
                PORTION
              </button>
              <button 
                onClick={() => setScalingMode("batch")}
                className={cn("scaler-tab", scalingMode === "batch" && "active")}
              >
                BATCH
              </button>
            </div>

            {scalingMode === "portion" ? (
              <div className="portion-scaler-body flex items-center justify-between">
                <div className="portion-left">
                  <div className="flex items-center gap-2">
                    <Scale className="w-4 h-4 text-text-2" />
                    <span className="portion-label">PORTION SCALING</span>
                  </div>
                  <span className="portion-yield">Target yield: {isBatch ? `${((recipe.batchYield || 0) * yieldMultiplier).toFixed(1)} ${recipe.batchYieldUnit}` : `${(recipe.base_yield_quantity * yieldMultiplier).toFixed(1)} ${recipe.base_yield_unit}`}</span>
                </div>
                <div className="portion-controls">
                  <button 
                    onClick={() => setYieldMultiplier(Math.max(0.25, yieldMultiplier - 0.25))}
                    className="scale-btn"
                  >-</button>
                  <div className="scale-val">x{yieldMultiplier.toFixed(2)}</div>
                  <button 
                    onClick={() => setYieldMultiplier(yieldMultiplier + 0.25)}
                    className="scale-btn"
                  >+</button>
                </div>
              </div>
            ) : (
              <div className="batch-scaler">
                <div className="batch-input-row">
                  <span className="batch-input-label uppercase">Batch Multiplier</span>
                  <input 
                    type="number"
                    min="1"
                    value={yieldMultiplier}
                    onChange={(e) => setYieldMultiplier(parseFloat(e.target.value) || 1)}
                    className="batch-input"
                  />
                  <div className="batch-yield-result">
                    Target yield: <span>{isBatch ? `${((recipe.batchYield || 0) * yieldMultiplier).toFixed(1)} ${recipe.batchYieldUnit}` : `${(recipe.base_yield_quantity * yieldMultiplier).toFixed(1)} ${recipe.base_yield_unit}`}</span>
                  </div>
                </div>
                <div className="batch-presets">
                  <span className="batch-preset-label uppercase">Quick Presets</span>
                  {[5, 10, 20, 50, 100].map(val => (
                    <button 
                      key={val}
                      onClick={() => setYieldMultiplier(val)}
                      className={cn("batch-preset", yieldMultiplier === val && "active")}
                    >
                      ×{val}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {isBatch && (
          <>
            <div className="batch-yield-block">
              <span className="batch-yield-block-label uppercase">Batch Yield</span>
              <span className="batch-yield-block-value">{recipe.batchYield?.toLocaleString()} {recipe.batchYieldUnit}</span>
            </div>
            <div className="storage-display">
              <span className="text-lg">
                {recipe.storage === 'fridge' ? '❄️' : recipe.storage === 'ambient' ? '🌡️' : '🧊'}
              </span>
              <span className="uppercase font-bold tracking-widest">{recipe.storage} Storage</span>
            </div>
          </>
        )}

        {scalingMode === "batch" && yieldMultiplier > 1 && (
          <div className="batch-banner">
            <span className="batch-banner-label uppercase tracking-[0.15em]">Batch Mode Active</span>
            <span className="batch-banner-value uppercase tracking-widest">×{yieldMultiplier} Service</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="border-r border-border">
            <h4 className="section-label text-text-3 p-[14px_20px_10px]">Ingredient Registry</h4>
            <div className="border-t border-border">
              {recipe.ingredients.map(ing => {
                const scaledQty = ing.quantity * yieldMultiplier;
                const isBatchIng = ing.type === 'batch_recipe';
                
                // Batch fraction logic
                let batchRefLabel = "";
                if (isBatchIng && ing.batchFraction) {
                  const scaledFraction = ing.batchFraction * yieldMultiplier;
                  batchRefLabel = scaledFraction < 1
                    ? `${scaledFraction.toFixed(3)} of batch`
                    : `${scaledFraction.toFixed(2)} batches needed`;
                }

                return (
                  <div key={ing.id} className="p-[14px_20px] border-b border-border flex items-center justify-between hover:bg-elevated transition-colors">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="ingredient-name text-text-1">{ing.name}</span>
                        {isBatchIng && <span className="text-[9px] font-mono text-amber border border-amber/20 bg-amber/5 px-1.5 py-0.5 rounded">BATCH</span>}
                      </div>
                      {isBatchIng && batchRefLabel && (
                        <span className="ingredient-batch-ref">{batchRefLabel}</span>
                      )}
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="flex items-baseline">
                        <span className={cn(
                          "ingredient-qty",
                          scalingMode === "batch" && yieldMultiplier > 1 ? "text-green" : "text-text-1"
                        )}>
                          {scaledQty.toFixed(1)}
                        </span>
                        <span className="ingredient-unit text-text-3 ml-[3px]">{ing.unit}</span>
                      </div>
                      {scalingMode === "batch" && yieldMultiplier > 1 && (
                        <span className="ingredient-original uppercase">
                          ×{yieldMultiplier} of {ing.quantity} {ing.unit}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-base/20">
            <h4 className="section-label text-text-3 p-[14px_20px_10px]">Preparation Protocol</h4>
            <div className="border-t border-border">
              {recipe.steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-[14px] p-[14px_20px] border-b border-border hover:bg-elevated transition-colors">
                  <span className="step-num text-text-3 pt-[2px] w-[18px] shrink-0">{idx < 9 ? `0${idx + 1}` : idx + 1}</span>
                  <p className="step-text text-text-1 flex-1">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {recipe.private_notes && canSeePrivateNotes && (
          <div className="p-8 border-t border-border bg-amber/5">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.2)]">
              <Info className="w-5 h-5 text-amber shrink-0 mt-0.5" />
              <div>
                <h5 className="note-label text-amber mb-1">Managerial Note — Private</h5>
                <p className="note-text text-text-2">{recipe.private_notes}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AISearch = () => {
  const [queryText, setQueryText] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const handleSearch = async (e: React.FormEvent | string) => {
    if (typeof e !== "string") e.preventDefault();
    const userMsg = typeof e === "string" ? e : queryText;
    if (!userMsg.trim() || loading) return;

    setQueryText("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

      // 1. Fetch recipes from Firestore for context
      const snapshot = await getDocs(collection(db, "recipes"));
      const recipes = snapshot.docs.map(doc => doc.data());

      // 2. Generate Grounded Response
      const contextStr = recipes.map((r: any) => 
        `Recipe: ${r.name}\nOrigin/Notes: ${r.description || "N/A"}\nStation: ${r.station_assignment}\nTags: ${r.tags?.join(", ") || "None"}\nBase Yield: ${r.base_yield_quantity} ${r.base_yield_unit}\nIngredients:\n${r.ingredients.map((i: any) => `- ${i.name}: ${i.quantity} ${i.unit}`).join("\n")}\nSteps:\n${r.steps.map((s: any, idx: number) => `${idx + 1}. ${s}`).join("\n")}\nFood Safety: Min Temp ${r.food_safety_metadata.min_temp}°F, Hold Time ${r.food_safety_metadata.hold_time}h ${r.food_safety_metadata.hold_time_minutes}m`
      ).join("\n\n---\n\n");

      const prompt = `
        You are the Franchise Recipe Vault Assistant. 
        Use the following retrieved recipe context to answer the user's question.
        If the information is not in the context, say you don't know.
        Cite the recipe names in your response.
        
        FORMATTING INSTRUCTIONS:
        - Use bullet points (-) for lists of ingredients.
        - Use numbered lists (1.) for step-by-step instructions.
        - Use bold text for recipe names and key terms.
        
        CONTEXT:
        ${contextStr}
        
        USER QUESTION:
        ${userMsg}
      `;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      setMessages(prev => [...prev, { role: "ai", content: result.text || "No response generated." }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: "ai", content: "Error processing request. Please check your connection." }]);
    } finally {
      setLoading(false);
    }
  };

  const suggestedQueries = [
    { emoji: "🍔", text: "How do I prep the Smash Burger?" },
    { emoji: "🥩", text: "What's the safe temp for beef patties?" },
    { emoji: "🍟", text: "Which station handles Truffle Fries?" }
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 flex flex-col h-[calc(100vh-120px)]">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-[44px] h-[44px] bg-green-bg border border-green-dim rounded-xl flex items-center justify-center">
          <span className="text-[20px] text-green">✦</span>
        </div>
        <div>
          <h2 className="vault-assistant-title">AI Recipe Assistant</h2>
          <p className="vault-assistant-sub">Semantic RAG Retrieval System</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 mb-6 pr-4 scrollbar-thin scrollbar-thumb-border">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-start justify-center max-w-md mx-auto w-full">
            <span className="ai-suggestion-label text-text-3 mb-4">Suggested Queries</span>
            <div className="space-y-3 w-full">
              {suggestedQueries.map((q, i) => (
                <button 
                  key={i}
                  onClick={() => handleSearch(q.text)}
                  className="flex items-center justify-between w-full bg-surface border border-border rounded-xl p-[12px_14px] hover:bg-elevated hover:border-border-hi transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">{q.emoji}</span>
                    <span className="ai-chip-text text-text-2">{q.text}</span>
                  </div>
                  <span className="ai-chip-arrow text-text-3">›</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, idx) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={idx} 
            className={cn(
              "flex flex-col max-w-[85%]",
              msg.role === "user" ? "ml-auto items-end" : "items-start"
            )}
          >
            <div className={cn(
              "px-4 py-3 rounded-2xl text-sm leading-relaxed",
              msg.role === "user" 
                ? "bg-green text-white rounded-tr-none" 
                : "bg-surface border border-border text-text-2 rounded-tl-none"
            )}>
              <div className="markdown-body prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
            <span className="text-[8px] font-mono text-text-3 uppercase tracking-widest mt-1">
              {msg.role === "user" ? "Operator" : "Vault AI"}
            </span>
          </motion.div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-text-3 font-mono text-[10px] uppercase tracking-widest">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Retrieving Embeddings...</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSearch} className="relative">
        <input 
          type="text"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="e.g., 'How do I prep the Smash Burger?'"
          className="vault-assistant-input w-full bg-surface border border-border rounded-xl px-6 py-4 text-text-1 placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-green/20 focus:border-green/50 transition-all"
        />
        <button 
          type="submit"
          disabled={loading}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-green hover:bg-green/80 disabled:opacity-50 disabled:hover:bg-green text-white rounded-lg flex items-center justify-center transition-colors"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
};

const Login = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate("/");
    }
  }, [user, loading, navigate]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-green" /></div>;

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-surface border border-border rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-16 h-16 bg-green-bg border border-green-dim rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ChefHat className="w-10 h-10 text-green" />
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight text-text-1 font-display uppercase mb-2">Vault Access</h2>
        <p className="text-text-3 font-mono text-xs uppercase tracking-widest mb-8">Authorized Personnel Only</p>
        
        <button 
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-zinc-200 text-black px-6 py-4 rounded-xl font-mono text-sm font-bold uppercase tracking-widest transition-all"
        >
          <LogIn className="w-5 h-5" />
          Sign in with Google
        </button>
        
        <div className="mt-8 pt-8 border-t border-border">
          <p className="text-[10px] font-mono text-text-3 uppercase tracking-widest leading-relaxed">
            Access to the Recipe Vault is restricted to franchise operators and verified kitchen staff.
          </p>
        </div>
      </div>
    </div>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-green" /></div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
};

export default function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-base text-text-1 selection:bg-green/30 transition-colors duration-300">
        <AuthProvider>
          <Router>
            <Header />
            <main>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={<ProtectedRoute><RecipeList /></ProtectedRoute>} />
                <Route path="/recipe/:id" element={<ProtectedRoute><RecipeDetail /></ProtectedRoute>} />
                <Route path="/search" element={<ProtectedRoute><AISearch /></ProtectedRoute>} />
                <Route path="/add" element={<ProtectedRoute><RecipeForm /></ProtectedRoute>} />
                <Route path="/edit/:id" element={<ProtectedRoute><RecipeForm /></ProtectedRoute>} />
              </Routes>
            </main>
          </Router>
        </AuthProvider>
        
        {/* Visual Background Elements */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10 opacity-30">
          <div className="absolute top-0 left-1/4 w-px h-full bg-border/50" />
          <div className="absolute top-0 right-1/4 w-px h-full bg-border/50" />
          <div className="absolute top-1/4 left-0 w-full h-px bg-border/50" />
          <div className="absolute bottom-1/4 left-0 w-full h-px bg-border/50" />
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,var(--green-bg),transparent_70%)]" />
        </div>
      </div>
    </ThemeProvider>
  );
}
