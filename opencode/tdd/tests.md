# Tests buenos y malos

## Tests buenos

**Estilo integracion**: testear a traves de interfaces reales, no mocks de partes internas.

```typescript
// GOOD: testea comportamiento observable
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

Caracteristicas:

- Testea comportamiento que le importa a usuarios/callers
- Usa solo la API publica
- Sobrevive refactors internos
- Describe QUE, no COMO
- Una asercion logica por test

## Tests malos

**Tests de detalle de implementacion**: acoplados a la estructura interna.

```typescript
// BAD: testea detalles de implementacion
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

Senales de alarma:

- Mockear colaboradores internos
- Testear metodos privados
- Asertar sobre cantidad u orden de llamadas
- El test se rompe al refactorizar sin cambio de comportamiento
- El nombre del test describe COMO y no QUE
- Verificar por medios externos en vez de por la interfaz

```typescript
// BAD: saltea la interfaz para verificar
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});

// GOOD: verifica a traves de la interfaz
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

**Tests tautologicos**: el valor esperado re-enuncia la implementacion, asi que el test pasa por construccion.

```typescript
// BAD: el valor esperado se recomputa igual que lo computa el codigo
test("calculateTotal sums line items", () => {
  const items = [{ price: 10 }, { price: 5 }];
  const expected = items.reduce((sum, i) => sum + i.price, 0);
  expect(calculateTotal(items)).toBe(expected);
});

// GOOD: el valor esperado es un literal independiente y conocido
test("calculateTotal sums line items", () => {
  expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
});
```
