import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Image, FlatList, ScrollView, TouchableOpacity, Linking, ImageBackground, Modal, Alert } from 'react-native';
import {
  Text, Searchbar, Card, Button, Portal, Dialog, ActivityIndicator,
  Provider as PaperProvider, MD3DarkTheme, Badge, ProgressBar, IconButton, Divider, Snackbar, TextInput
} from 'react-native-paper';
import axios from 'axios';
import cheerio from 'react-native-cheerio';
import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';

// --- CONFIG DB ---
const db = SQLite.openDatabaseSync('mauleCart.db');
const WHATSAPP_NUMBER = '+56934974829';

// --- INTERFACES ---
interface StockItem { talla: string; cant: number; }
interface ProductDetails { price: string; stock: StockItem[]; loaded: boolean; }
interface Product { id: string; name: string; link: string; img: string; brand: string; details: ProductDetails; }
interface CartItem { id: number; name: string; size: string; price: string; img: string; link: string; qty: number; }

const theme = { ...MD3DarkTheme, colors: { ...MD3DarkTheme.colors, primary: '#f9d423', background: '#000000', surface: '#121212' } };

const CATEGORIES: Record<string, string> = {
  "VER TODOS": "", "Polerones": "polerones", "Conjuntos Gorro": "conjuntos-de-adultos-con-gorro",
  "Conjuntos Cierre": "conjunto-de-adulto-con-cierre", "Poleras": "poleras-de-adulto",
  "Shorts": "short-y-polera-adulto", "Niños": "conjunto-de-nino", "SALE": "sale"
};

const BRANDS = ["Jordan", "Trapstar", "Nike", "Adidas", "Puma", "SikSilk", "Armani", "Hugo Boss", "Tommy", "MK", "CK", "Lacoste", "Guess", "Ferrari", "Redbull", "BMW", "AMG", "Yankees", "Chicago Bulls", "Sp5der"];
const SIZE_FILTERS = ["12", "14", "16", "S", "M", "L", "XL"];
const DISPLAY_SIZE_FILTERS = ["S", "M", "L", "XL"];

const stockCache: Record<string, ProductDetails> = {};

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [scanning, setScanning] = useState(0);
  const [page, setPage] = useState(1);
  const [cat, setCat] = useState("");
  const [search, setSearch] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("VER TODOS");
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [visible, setVisible] = useState(false);
  const [imgModal, setImgModal] = useState(false);
  const [cartVisible, setCartVisible] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState("");
  const [nameModal, setNameModal] = useState(false);

  const [userName, setUserName] = useState<string | null>(null);
  const [tempName, setTempName] = useState("");

  const [selectedImg, setSelectedImg] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [pickingSize, setPickingSize] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  const initDB = useCallback(() => {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS cart (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, size TEXT, price TEXT, img TEXT, link TEXT, qty INTEGER DEFAULT 1);
      CREATE TABLE IF NOT EXISTS user (id INTEGER PRIMARY KEY DEFAULT 1, name TEXT);
    `);
    try { db.execSync('ALTER TABLE cart ADD COLUMN qty INTEGER DEFAULT 1;'); } catch (e) { }
    const user = db.getFirstSync<{ name: string }>('SELECT name FROM user WHERE id = 1');
    if (user && user.name) setUserName(user.name); else setNameModal(true);
    refreshCart();
  }, []);

  const saveUserName = () => {
    if (!tempName.trim()) return;
    db.runSync('INSERT OR REPLACE INTO user (id, name) VALUES (1, ?)', [tempName.trim()]);
    setUserName(tempName.trim());
    setNameModal(false);
  };

  const refreshCart = () => { try { const rows = db.getAllSync<CartItem>('SELECT * FROM cart'); setCartItems(rows || []); } catch (e) { } };

  const addToCart = (product: Product, size: string) => {
    try {
      const existing = db.getFirstSync<CartItem>('SELECT * FROM cart WHERE name = ? AND size = ?', [product.name, size]);
      if (existing) {
        db.runSync('UPDATE cart SET qty = qty + 1 WHERE id = ?', [existing.id]);
        setSnackbarMsg(`Cantidad de ${size} actualizada! 📦`);
      } else {
        db.runSync('INSERT INTO cart (name, size, price, img, link) VALUES (?, ?, ?, ?, ?)', [product.name, size, product.details.price, product.img, product.link]);
        setSnackbarMsg(`¡Listo ${userName}! Al carrito. 🛍️`);
      }
      refreshCart(); setVisible(false); setPickingSize(null); setSnackbarVisible(true);
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const updateCartQty = (id: number, delta: number) => {
    const item = cartItems.find(i => i.id === id);
    if (!item) return;
    const n = item.qty + delta;
    if (n <= 0) removeFromCart(id); else { db.runSync('UPDATE cart SET qty = ? WHERE id = ?', [n, id]); refreshCart(); }
  };

  const removeFromCart = (id: number) => { db.runSync('DELETE FROM cart WHERE id = ?', [id]); refreshCart(); };
  const clearCart = () => { db.runSync('DELETE FROM cart'); setCartItems([]); };
  const calculateTotal = () => cartItems.reduce((acc, item) => acc + ((parseInt(item.price.replace(/[^\d]/g, '')) || 0) * item.qty), 0);

  const sendWhatsAppOrder = () => {
    if (cartItems.length === 0) return;
    let msg = `Hola Maule Style! 👋 Mi nombre es ${userName}. Pedido:\n\n`;
    cartItems.forEach(item => msg += `- ${item.name} (${item.qty} u) | Talla: ${item.size} - ${item.price}\n`);
    msg += `\n*TOTAL: $${calculateTotal().toLocaleString()}*`;
    Linking.openURL(`whatsapp://send?phone=${WHATSAPP_NUMBER}&text=${encodeURIComponent(msg)}`).catch(() => Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER.replace('+', '')}?text=${encodeURIComponent(msg)}`));
  };

  useEffect(() => { initDB(); }, [initDB]);

  const fetchCatalog = async (pNum: number, isMore = false) => {
    if (!isMore) { setLoading(true); setProducts([]); setHasMore(true); } else setLoadingMore(true);
    setScanning(0.1);
    try {
      const { data } = await axios.get(`https://overflycl.com/page/${pNum}/?s=${search}&product_cat=${cat}&post_type=product`, { timeout: 10000 });
      const $ = cheerio.load(data);
      let items: Product[] = [];
      $('.product-grid-item').each((index, element) => {
        const titleTag = $(element).find('.wd-entities-title a');
        if (titleTag.length) {
          const name = titleTag.text().trim();
          const brand = BRANDS.find(b => name.toLowerCase().includes(b.toLowerCase())) || "MAULE";
          const link = titleTag.attr('href') || "";
          const imgTag = $(element).find('.product-image-link img');
          let img = imgTag.attr('data-wood-src') || imgTag.attr('data-src') || imgTag.attr('src') || "";
          if (selectedBrand === "VER TODOS" || brand.toLowerCase() === selectedBrand.toLowerCase()) {
            items.push({ id: `${pNum}-${index}-${link}`, name, link, img, brand, details: stockCache[link] || { price: "...", stock: [], loaded: false } });
          }
        }
      });
      if (isMore) setProducts(prev => [...prev, ...items]); else setProducts(items);
      setScanning(0.3);
      const itemsToLoad = items.filter(i => !i.details.loaded);
      let loadedCount = 0;
      await Promise.all(itemsToLoad.map(async (item) => {
        try {
          const resDetail = await axios.get(item.link, { timeout: 8000 });
          const $$ = cheerio.load(resDetail.data);
          const p = $$('.price').first().text().trim() || "N/A";
          const vData = $$('.variations_form').attr('data-product_variations');
          let s: StockItem[] = vData ? JSON.parse(vData).map((v: any) => ({ talla: v.attributes.attribute_pa_talla ? v.attributes.attribute_pa_talla.toUpperCase() : "ÚNICA", cant: v.max_qty || 0 })) : [{ talla: "ÚNICA", cant: 1 }];
          const f = { price: p, stock: s, loaded: true };
          stockCache[item.link] = f;
          setProducts(prev => prev.map(p => p.link === item.link ? { ...p, details: f } : p));
        } catch (e) { } finally { loadedCount++; setScanning(0.3 + (loadedCount / itemsToLoad.length) * 0.7); }
      }));
    } catch (err) { setHasMore(false); } finally { setLoading(false); setLoadingMore(false); setScanning(0); }
  };

  useEffect(() => { setPage(1); fetchCatalog(1, false); }, [cat, selectedBrand]);
  const loadMore = () => { if (!loading && !loadingMore && !scanning && hasMore) { const nextP = page + 1; setPage(nextP); fetchCatalog(nextP, true); } };

  const filteredData = products.filter(p => !selectedSize || (p.details.loaded && p.details.stock.some(s => s.talla.toUpperCase() === selectedSize && s.cant > 0)));

  const isClothing = selectedProduct?.details.stock.some(s => ["12", "14", "16", "S", "M", "L", "XL"].includes(s.talla.toUpperCase()));

  return (
    <PaperProvider theme={theme}>
      <View style={styles.container}>
        <StatusBar style="light" />

        {/* BANNER DE TIENDA DINÁMICO */}
        <ImageBackground
          source={require('./logo.png')}
          style={styles.topBanner}
          imageStyle={{ opacity: 0.6, transform: [{ scale: 1.8 }] }}
          resizeMode="cover"
        >
          <View style={styles.overlay}>
            <View style={styles.topBar}>
              <View>
                <Text variant="headlineSmall" style={styles.mainTitle}>MAULE STYLE</Text>
                {userName && <Text style={styles.welcomeText}>Hola, {userName} 👋</Text>}
              </View>
              <TouchableOpacity onPress={() => setCartVisible(true)} style={styles.cartIconBtn}>
                <IconButton icon="cart" iconColor="#f9d423" size={24} />
                {cartItems.length > 0 && <Badge size={18} style={styles.cartBadge}>{cartItems.reduce((a, b) => a + b.qty, 0)}</Badge>}
              </TouchableOpacity>
            </View>

            <Searchbar
              placeholder="Buscar..."
              onChangeText={setSearch}
              value={search}
              onSubmitEditing={() => fetchCatalog(1, false)}
              style={styles.search}
              iconColor="#f9d423"
            />

            <TouchableOpacity
              onPress={() => setShowFilters(!showFilters)}
              style={styles.filterToggle}
            >
              <Text style={styles.filterToggleText}>
                {showFilters ? "CERRAR FILTROS ▲" : "FILTRAR PRODUCTOS ▼"}
              </Text>
              {(cat || selectedBrand !== "VER TODOS" || selectedSize) && <Badge size={8} style={styles.filterBadge} />}
            </TouchableOpacity>
          </View>
        </ImageBackground>

        <View style={{ paddingHorizontal: 10, flex: 1 }}>
          {showFilters && (
            <View style={styles.accordionBody}>
              <View style={{ height: 35, marginBottom: 8 }}><ScrollView horizontal>{Object.keys(CATEGORIES).map(k => (<TouchableOpacity key={k} onPress={() => setCat(cat === CATEGORIES[k] ? "" : CATEGORIES[k])} style={[styles.chip, { backgroundColor: cat === CATEGORIES[k] ? '#f9d423' : '#222' }]}><Text style={{ color: cat === CATEGORIES[k] ? '#000' : '#fff', fontWeight: 'bold', fontSize: 11 }}>{k}</Text></TouchableOpacity>))}</ScrollView></View>
              <View style={{ height: 35, marginBottom: 8 }}><ScrollView horizontal>{["VER TODOS", ...BRANDS].map(b => (<TouchableOpacity key={b} onPress={() => setSelectedBrand(selectedBrand === b ? "VER TODOS" : b)} style={[styles.chip, { backgroundColor: (selectedBrand === b && b !== "VER TODOS") || (b === "VER TODOS" && selectedBrand === "VER TODOS") ? '#fff' : '#111', borderWeight: 1, borderColor: '#333' }]}><Text style={{ color: (selectedBrand === b && b !== "VER TODOS") || (b === "VER TODOS" && selectedBrand === "VER TODOS") ? '#000' : '#888', fontWeight: 'bold', fontSize: 10 }}>{b}</Text></TouchableOpacity>))}</ScrollView></View>
              <View style={{ height: 35 }}><ScrollView horizontal><View style={{ width: 80, justifyContent: 'center' }}><Text style={{ color: '#888', fontSize: 10, fontWeight: 'bold' }}>TALLA:</Text></View>{DISPLAY_SIZE_FILTERS.map(s => (<TouchableOpacity key={s} onPress={() => setSelectedSize(selectedSize === s ? null : s)} style={[styles.sizeChip, { backgroundColor: selectedSize === s ? '#f9d423' : '#333' }]}><Text style={{ color: selectedSize === s ? '#000' : '#fff', fontWeight: 'bold' }}>{s}</Text></TouchableOpacity>))}</ScrollView></View>
            </View>
          )}

          {scanning > 0 && <ProgressBar progress={scanning} color="#f9d423" style={{ height: 2, marginBottom: 10 }} />}
          {loading ? (<View style={styles.center}><ActivityIndicator color="#f9d423" size="large" /></View>) : (
            <FlatList
              data={filteredData}
              renderItem={({ item }) => {
                const sL = item.details.stock.some(s => ["S", "M", "L", "XL"].includes(s.talla.toUpperCase()));
                const sN = item.details.stock.some(s => !isNaN(parseInt(s.talla)));
                return (
                  <Card style={styles.card}>
                    <TouchableOpacity onPress={() => { setSelectedImg(item.img); setImgModal(true); }}><Card.Cover source={{ uri: item.img || 'https://via.placeholder.com/150' }} style={styles.cardImg} /></TouchableOpacity>
                    <Card.Content style={styles.cardContent}>
                      <Badge style={styles.badge}>{item.brand}</Badge>
                      <Text variant="titleSmall" style={styles.title} numberOfLines={2}>{item.name}</Text>
                      <View style={styles.cardSizeRow}>{sL ? (["S", "M", "L", "XL"].map(sz => { const st = item.details.stock.find(s => s.talla.toUpperCase() === sz); const hs = st && st.cant > 0; return (<View key={sz} style={styles.cardSizeItem}><Text style={[styles.cardSizeText, !hs && styles.cardSizeTextEmpty]}>{sz}</Text>{!hs && <View style={styles.redXOverlay}><Text style={{ color: 'red', fontSize: 8, fontWeight: '900' }}>X</Text></View>}</View>); })) : sN ? (item.details.stock.slice(0, 4).map((s, idx) => (<View key={idx} style={styles.cardSizeItem}><Text style={styles.cardSizeText}>{s.talla}</Text>{s.cant === 0 && <View style={styles.redXOverlay}><Text style={{ color: 'red', fontSize: 8, fontWeight: '900' }}>X</Text></View>}</View>))) : null}</View>
                      <View style={styles.cardFooter}><Text variant="headlineSmall" style={styles.price}>{item.details.price}</Text><IconButton icon="cart-plus" size={18} iconColor="#f9d423" onPress={() => { setSelectedProduct(item); setVisible(true); }} /></View>
                    </Card.Content>
                  </Card>
                );
              }}
              keyExtractor={item => item.id}
              numColumns={2}
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              contentContainerStyle={styles.list}
              ListFooterComponent={loadingMore ? <ActivityIndicator color="#f9d423" style={{ margin: 20 }} /> : !hasMore ? <View style={{ padding: 40 }}><Text style={{ color: '#555', textAlign: 'center', fontWeight: 'bold', letterSpacing: 2 }}>LLEGASTE AL FINAL 🏁💎</Text></View> : null}
            />
          )}
        </View>

        <Portal>
          <Modal visible={cartVisible} onDismiss={() => setCartVisible(false)} transparent={false}>
            <View style={styles.cartModalContainer}>
              <View style={styles.cartTop}><Text variant="headlineSmall" style={styles.cartTitle}>TU CARRITO 🛒</Text><IconButton icon="close" iconColor="#fff" size={24} onPress={() => setCartVisible(false)} /></View>
              <FlatList data={cartItems} keyExtractor={item => item.id.toString()} ListEmptyComponent={<View style={styles.emptyCart}><Text style={{ color: '#666' }}>Tu carrito está vacío</Text></View>} renderItem={({ item }) => (
                <View style={styles.cartItem}>
                  <Image source={{ uri: item.img }} style={styles.cartItemImg} />
                  <View style={{ flex: 1, marginLeft: 15 }}>
                    <Text style={styles.cartItemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.cartItemSize}>Talla: {item.size}</Text>
                    <View style={styles.cartControls}><View style={styles.qtyBox}><IconButton icon="minus" size={14} iconColor="#f9d423" style={styles.qtyBtn} onPress={() => updateCartQty(item.id, -1)} /><Text style={styles.qtyTextVal}>{item.qty}</Text><IconButton icon="plus" size={14} iconColor="#f9d423" style={styles.qtyBtn} onPress={() => updateCartQty(item.id, 1)} /></View><Text style={styles.cartItemPrice}>{item.price}</Text></View>
                  </View>
                  <IconButton icon="delete-outline" iconColor="#ff4444" size={20} onPress={() => removeFromCart(item.id)} />
                </View>
              )} />
              <View style={styles.cartBottom}>
                <View style={styles.totalRow}><Text style={styles.totalLabel}>TOTAL:</Text><Text style={styles.totalPrice}>${calculateTotal().toLocaleString()}</Text></View>
                <Button mode="contained" buttonColor="#f9d423" textColor="#000" style={styles.checkoutBtn} labelStyle={{ fontWeight: 'bold' }} onPress={sendWhatsAppOrder}>PEDIR POR WHATSAPP 📲</Button>
                <Button onPress={clearCart} textColor="#666">Vaciar Carrito</Button>
              </View>
            </View>
          </Modal>
          <Modal visible={imgModal} onDismiss={() => setImgModal(false)} transparent={false}><View style={styles.fullImgContainer}><IconButton icon="close" size={30} iconColor="#fff" style={styles.closeBtn} onPress={() => setImgModal(false)} />{selectedImg && <Image source={{ uri: selectedImg }} style={styles.fullImg} resizeMode="contain" />}</View></Modal>
          <Dialog visible={visible} onDismiss={() => setVisible(false)} style={styles.dialog}>
            <Dialog.Title style={{ color: '#fff', fontSize: 16 }}>{isClothing ? "Seleccionar Talla:" : "Añadir al Carrito"}</Dialog.Title>
            <Dialog.Content>
              {isClothing ? (<View style={styles.stockGrid}>{selectedProduct && SIZE_FILTERS.map(size => { const stockItem = selectedProduct.details.stock.find(s => s.talla.toUpperCase() === size); const hasStock = stockItem && stockItem.cant > 0; if (!stockItem && !["S", "M", "L", "XL"].includes(size)) return null; return (<TouchableOpacity key={size} disabled={!hasStock} onPress={() => setPickingSize(size)} style={[styles.sizeBox, !hasStock && styles.sizeBoxEmpty, pickingSize === size && styles.sizeBoxSelected]}><Text style={[styles.sizeText, !hasStock && styles.sizeTextEmpty, pickingSize === size && { color: '#000' }]}>{size}</Text>{hasStock ? <Text style={[styles.qtyText, pickingSize === size && { color: '#000' }]}>{stockItem.cant}</Text> : <Text style={{ color: '#ff4444', fontWeight: 'bold' }}>X</Text>}</TouchableOpacity>); })}</View>) : (<View style={{ alignItems: 'center', padding: 20 }}><Text style={{ color: '#fff', textAlign: 'center' }}>Talla Única disponible.</Text></View>)}
              <Divider style={{ marginVertical: 10, backgroundColor: '#333' }} />
              <Button mode="contained" disabled={isClothing && !pickingSize} buttonColor="#f9d423" textColor="#000" style={{ marginTop: 10 }} labelStyle={{ fontWeight: 'bold' }} onPress={() => selectedProduct && addToCart(selectedProduct, isClothing ? pickingSize! : "ÚNICA")}>{isClothing ? (pickingSize ? `AÑADIR TALLA ${pickingSize}` : 'SELECCIONA TALLA') : 'AÑADIR AL CARRITO (Única)'}</Button>
            </Dialog.Content>
            <Dialog.Actions><Button onPress={() => setVisible(false)} textColor="#666">CANCELAR</Button></Dialog.Actions>
          </Dialog>
        </Portal>
        <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={2000} style={styles.snackbar} action={{ label: 'Ver Carrito', onPress: () => { setCartVisible(true); } }}>{snackbarMsg}</Snackbar>

        <Modal visible={nameModal} transparent={false} animationType="fade" statusBarTranslucent={true}>
          <View style={styles.fullScreenModal}>
            <Image source={{ uri: 'https://overflycl.com/wp-content/uploads/2023/04/cropped-logo-overfly-1.png' }} style={styles.onboardingLogo} resizeMode="contain" />
            <Text variant="headlineSmall" style={styles.onboardingTitle}>¡BIENVENIDO!</Text>
            <Text style={styles.onboardingSub}>Dinos tu nombre para personalizar tu pedido:</Text>
            <TextInput
              mode="outlined"
              placeholder="Nombre..."
              textColor="#f9d423"
              placeholderTextColor="#666"
              outlineColor="#333"
              activeOutlineColor="#f9d423"
              style={styles.onboardingInput}
              onChangeText={setTempName}
              value={tempName}
            />
            <Button mode="contained" buttonColor="#f9d423" textColor="#000" style={styles.onboardingBtn} onPress={saveUserName}>INGRESAR</Button>
          </View>
        </Modal>
      </View>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBanner: { height: 260, width: '100%', overflow: 'hidden' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: 20 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mainTitle: { color: '#f9d423', fontWeight: 'bold', fontSize: 24, letterSpacing: 2 },
  welcomeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  cartIconBtn: { position: 'relative' },
  cartBadge: { position: 'absolute', top: 5, right: 5, backgroundColor: '#ff4444', color: '#fff' },
  search: { backgroundColor: '#111', marginTop: 10, marginBottom: 10, borderRadius: 12 },
  filterToggle: { flexDirection: 'row', backgroundColor: '#1a1a1a', padding: 8, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  filterToggleText: { color: '#f9d423', fontWeight: 'bold', fontSize: 11, letterSpacing: 1 },
  filterBadge: { backgroundColor: '#f9d423', position: 'absolute', top: 10, right: 10 },
  accordionBody: { backgroundColor: '#0a0a0a', padding: 8, borderRadius: 12, marginBottom: 15, borderLeftWidth: 3, borderLeftColor: '#f9d423' },
  chip: { borderRadius: 15, paddingHorizontal: 15, justifyContent: 'center', marginRight: 8, height: 30 },
  sizeChip: { borderRadius: 8, width: 40, height: 30, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  list: { paddingBottom: 20 },
  card: { flex: 0.5, margin: 4, backgroundColor: '#111', borderRadius: 12, overflow: 'hidden' },
  cardImg: { height: 140 },
  cardContent: { padding: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 },
  badge: { backgroundColor: '#f9d423', color: '#000', fontWeight: 'bold', alignSelf: 'flex-start', marginBottom: 4, fontSize: 8 },
  title: { color: '#fff', fontSize: 11, fontWeight: 'bold', marginBottom: 8 },
  cardSizeRow: { flexDirection: 'row', marginTop: 5, marginBottom: 10, height: 22 },
  cardSizeItem: { marginRight: 4, width: 22, height: 18, backgroundColor: '#222', borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  cardSizeText: { color: '#f9d423', fontSize: 8, fontWeight: 'bold' },
  cardSizeTextEmpty: { color: '#444' },
  redXOverlay: { position: 'absolute', top: -3, right: -2 },
  price: { color: '#f9d423', fontWeight: 'bold', fontSize: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fullImgContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fullImg: { width: '100%', height: '80%' },
  closeBtn: { position: 'absolute', top: 40, right: 20, zIndex: 10 },
  dialog: { backgroundColor: '#111', borderRadius: 20 },
  stockGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 10 },
  sizeBox: { width: 55, height: 65, backgroundColor: '#1a1a1a', borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  sizeBoxEmpty: { opacity: 0.2, borderColor: '#222' },
  sizeBoxSelected: { backgroundColor: '#f9d423', borderColor: '#f9d423' },
  sizeText: { color: '#f9d423', fontWeight: 'bold', fontSize: 16 },
  sizeTextEmpty: { color: '#444' },
  qtyText: { color: '#888', fontSize: 10, marginTop: 2 },
  fullScreenModal: { flex: 1, backgroundColor: '#000', padding: 30, justifyContent: 'center', alignItems: 'center' },
  onboardingLogo: { width: 200, height: 100, marginBottom: 20 },
  onboardingTitle: { color: '#f9d423', fontWeight: 'bold', letterSpacing: 3, marginBottom: 10 },
  onboardingSub: { color: '#f9d423', textAlign: 'center', marginBottom: 30, opacity: 0.8 },
  onboardingInput: { width: '100%', marginBottom: 20, backgroundColor: '#111' },
  onboardingBtn: { width: '100%', height: 50, justifyContent: 'center', borderRadius: 12 },
  cartModalContainer: { flex: 1, backgroundColor: '#000', padding: 20, paddingTop: 50 },
  cartTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  cartTitle: { color: '#f9d423', fontWeight: 'bold' },
  cartItem: { flexDirection: 'row', backgroundColor: '#111', borderRadius: 15, padding: 10, marginBottom: 15, alignItems: 'center' },
  cartItemImg: { width: 60, height: 60, borderRadius: 10 },
  cartItemName: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  cartItemSize: { color: '#f9d423', fontSize: 11 },
  cartControls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  qtyBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 5 },
  qtyBtn: { margin: 0, width: 24, height: 24 },
  qtyTextVal: { color: '#fff', marginHorizontal: 8, fontWeight: 'bold', fontSize: 14 },
  cartItemPrice: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  emptyCart: { padding: 50, alignItems: 'center' },
  cartBottom: { padding: 20, borderTopWidth: 1, borderTopColor: '#222' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  totalLabel: { color: '#888', fontSize: 18 },
  totalPrice: { color: '#f9d423', fontSize: 24, fontWeight: 'bold' },
  checkoutBtn: { height: 50, justifyContent: 'center', borderRadius: 15, marginBottom: 5 },
  snackbar: { backgroundColor: '#1a1a1a', borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#f9d423' }
});
