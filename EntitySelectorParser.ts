import {
  world,
  Dimension,
  Entity,
  EntityQueryOptions, // 標準の EntityQueryOptions を使用
  GameMode,
  Vector3,
  Player,
  ItemStack,
  EntityInventoryComponent,
  EntityEquippableComponent,
  EquipmentSlot,
  ItemDurabilityComponent,
  ItemComponentTypes,
  EntityTypeFamilyComponent,
  Vector2,
  EntityQueryScoreOptions, // 追加: API標準のスコアオプション型
} from "@minecraft/server";

// HasItem のための拡張 (もし EntityQueryOptions に hasitem がない場合)
// interface EntityQueryOptionsEx extends EntityQueryOptions {
//   // hasitem など、将来的に追加するかもしれないカスタムオプション用
// }

// HasItem フィルターの条件 (これはカスタムのまま)
interface HasItemFilter {
  item?: string;
  quantity?: { min?: number; max?: number };
  data?: number;
  location?: string;
  slot?: { min?: number; max?: number };
}

export class EntitySelector {
  private readonly selectorString: string;
  private readonly executionDimension: Dimension;
  private readonly executionLocation?: Vector3;
  private readonly executor?: Entity;

  private targetSelectorSymbol: string;
  private queryOptions: EntityQueryOptions = {}; // 標準の EntityQueryOptions を使用
  private hasItemFilters: HasItemFilter[] = []; // HasItem はカスタムのまま

  constructor(selectorString: string, executionDimension: Dimension, executionLocation?: Vector3, executor?: Entity) {
    this.selectorString = selectorString;
    this.executionDimension = executionDimension;
    this.executionLocation = executionLocation || executor?.location;
    this.executor = executor;
    this.targetSelectorSymbol = "@e";
    this._parseSelectorString();
  }

  private _parseSelectorString(): void {
    // (変更なし)
    const selectorMatch = this.selectorString.match(/^(@[parse])(?:\[(.*?)\])?$/);
    if (!selectorMatch) {
      console.warn(`[EntitySelector] 無効なセレクター形式: ${this.selectorString}. "@e"を使用します.`);
      if (!this.selectorString.includes("[")) return;
      const argsOnlyMatch = this.selectorString.match(/^\[(.*?)\]$/);
      if (argsOnlyMatch) {
        this.targetSelectorSymbol = "@e";
        const argsString = argsOnlyMatch[1];
        if (argsString) this._parseArguments(argsString);
      }
      return;
    }
    this.targetSelectorSymbol = selectorMatch[1];
    const argsString = selectorMatch[2];
    if (argsString) this._parseArguments(argsString);
  }

  private _parseArguments(argsString: string): void {
    const args: string[] = [];
    let currentArg = "";
    let inBraces = 0;
    let inSquareBrackets = 0;

    for (let i = 0; i < argsString.length; i++) {
      const char = argsString[i];
      currentArg += char;
      if (char === "{") inBraces++;
      else if (char === "}") inBraces--;
      else if (char === "[") inSquareBrackets++;
      else if (char === "]") inSquareBrackets--;
      else if (char === "," && inBraces === 0 && inSquareBrackets === 0) {
        args.push(currentArg.slice(0, -1).trim());
        currentArg = "";
      }
    }
    args.push(currentArg.trim());

    for (const arg of args) {
      if (!arg) continue;
      const [key, ...valueParts] = arg.split("=");
      const value = valueParts.join("=").trim();
      if (!key || value === undefined) {
        console.warn(`[EntitySelector] 無効な引数形式: ${arg}`);
        continue;
      }
      const trimmedKey = key.trim();
      let trimmedValue = value.replace(/^"|"$/g, "");

      switch (trimmedKey) {
        // EntityFilter プロパティ
        case "type":
          if (trimmedValue.startsWith("!")) {
            if (!this.queryOptions.excludeTypes) this.queryOptions.excludeTypes = [];
            this.queryOptions.excludeTypes.push(trimmedValue.substring(1));
          } else {
            this.queryOptions.type = trimmedValue;
          }
          break;
        case "name":
          this.queryOptions.name = trimmedValue;
          break;
        case "tag":
          if (trimmedValue.startsWith("!")) {
            if (!this.queryOptions.excludeTags) this.queryOptions.excludeTags = [];
            this.queryOptions.excludeTags.push(trimmedValue.substring(1));
          } else {
            if (!this.queryOptions.tags) this.queryOptions.tags = [];
            this.queryOptions.tags.push(trimmedValue);
          }
          break;
        case "family":
          if (trimmedValue.startsWith("!")) {
            if (!this.queryOptions.excludeFamilies) this.queryOptions.excludeFamilies = [];
            this.queryOptions.excludeFamilies.push(trimmedValue.substring(1));
          } else {
            if (!this.queryOptions.families) this.queryOptions.families = [];
            this.queryOptions.families.push(trimmedValue);
          }
          break;
        case "m":
          this.queryOptions.gameMode = trimmedValue as GameMode;
          break;
        case "l":
          this.queryOptions.maxLevel = parseInt(trimmedValue, 10);
          break;
        case "lm":
          this.queryOptions.minLevel = parseInt(trimmedValue, 10);
          break;
        case "x":
        case "y":
        case "z":
          if (!this.queryOptions.location) {
            this.queryOptions.location = {
              x: this.executionLocation?.x ?? 0,
              y: this.executionLocation?.y ?? 0,
              z: this.executionLocation?.z ?? 0,
            };
          }
          (this.queryOptions.location as any)[trimmedKey] = parseFloat(trimmedValue);
          break;
        case "dx":
        case "dy":
        case "dz":
          if (!this.queryOptions.volume) this.queryOptions.volume = { x: 0, y: 0, z: 0 };
          (this.queryOptions.volume as any)[trimmedKey.charAt(1)] = parseFloat(trimmedValue);
          break;
        case "r":
          this.queryOptions.maxDistance = parseInt(trimmedValue, 10);
          break;
        case "rm":
          this.queryOptions.minDistance = parseInt(trimmedValue, 10);
          break;
        case "c":
          const count = parseInt(trimmedValue, 10);
          if (!isNaN(count)) {
            if (count > 0) this.queryOptions.closest = count;
            else if (count < 0) this.queryOptions.farthest = Math.abs(count);
          }
          break;
        case "rx":
          this.queryOptions.maxVerticalRotation = parseFloat(trimmedValue);
          break;
        case "rxm":
          this.queryOptions.minVerticalRotation = parseFloat(trimmedValue);
          break;
        case "ry":
          this.queryOptions.maxHorizontalRotation = parseFloat(trimmedValue);
          break;
        case "rym":
          this.queryOptions.minHorizontalRotation = parseFloat(trimmedValue);
          break;
        case "scores":
          // EntityQueryOptions.scoreOptions を使用する
          if (trimmedValue.startsWith("{") && trimmedValue.endsWith("}")) {
            const scoreArgs = trimmedValue.substring(1, trimmedValue.length - 1).split(",");
            if (!this.queryOptions.scoreOptions) this.queryOptions.scoreOptions = [];
            for (const scoreArg of scoreArgs) {
              const [objName, scoreValStr] = scoreArg.split("=");
              if (objName && scoreValStr) {
                const scoreOption: EntityQueryScoreOptions = { objective: objName.trim() };
                const rangeMatch = scoreValStr.trim().match(/^(-?\d+)?\.\.(-?\d+)?$/);
                if (rangeMatch) {
                  if (rangeMatch[1]) scoreOption.minScore = parseInt(rangeMatch[1], 10);
                  if (rangeMatch[2]) scoreOption.maxScore = parseInt(rangeMatch[2], 10);
                } else {
                  const exactScore = parseInt(scoreValStr.trim(), 10);
                  if (!isNaN(exactScore)) {
                    scoreOption.minScore = exactScore;
                    scoreOption.maxScore = exactScore;
                  }
                }
                // exclude のパースはここでは省略 (コマンドセレクターの scores には通常 exclude がない)
                // もし必要なら !objective=... のような記法をパースする必要がある
                if (scoreOption.minScore !== undefined || scoreOption.maxScore !== undefined) {
                  this.queryOptions.scoreOptions.push(scoreOption);
                }
              }
            }
          }
          break;
        case "hasitem":
          try {
            const parseObjectString = (objStr: string): string => {
              const assignments = [];
              let currentPair = "";
              let braceDepth = 0;
              for (let i = 0; i < objStr.length; i++) {
                const char = objStr[i];
                if (char === "{") braceDepth++;
                else if (char === "}") {
                  braceDepth--;
                  currentPair += char;
                }
                else if (char === "," && braceDepth === 0) {
                  assignments.push(currentPair.trim());
                  currentPair = "";
                  continue;
                }
                else {
                  currentPair += char;
                }
              }
              if (currentPair.trim()) assignments.push(currentPair.trim());

              const jsonPairs = assignments.map((assign) => {
                const parts = assign.split("=");
                const key = parts[0].trim();
                const value = parts.slice(1).join("=").trim();
                const quotedKey = `"${key}"`;
                let processedValue: string;
                if (!isNaN(parseFloat(value)) && isFinite(Number(value)) && !value.includes("..")) {
                  processedValue = value;
                } else if (value.toLowerCase() === "true" || value.toLowerCase() === "false") {
                  processedValue = value.toLowerCase();
                } else if (value.startsWith('"') && value.endsWith('"')) {
                  processedValue = value;
                } else {
                  processedValue = `"${value.replace(/"/g, '\\"')}"`;
                }
                return `${quotedKey}:${processedValue}`;
              });
              return `{${jsonPairs.join(",")}}`;
            };
            let parsedItems: any;
            const valueToParse = trimmedValue;
            if (valueToParse.startsWith("[")) {
              if (!valueToParse.endsWith("]")) throw new Error("Mismatched brackets in hasitem array.");
              const arrayContent = valueToParse.substring(1, valueToParse.length - 1);
              const objectStrings: string[] = [];
              if (arrayContent.trim() === "") {
                parsedItems = [];
              } else {
                let balance = 0;
                let startIndex = 0;
                for (let i = 0; i < arrayContent.length; i++) {
                  if (arrayContent[i] === "{") balance++;
                  else if (arrayContent[i] === "}") balance--;
                  else if (arrayContent[i] === "," && balance === 0 && i > startIndex) {
                    objectStrings.push(arrayContent.substring(startIndex, i));
                    startIndex = i + 1;
                  }
                }
                objectStrings.push(arrayContent.substring(startIndex));
                const processedObjects = objectStrings.map((objStr) => {
                  const trimmedObjStr = objStr.trim();
                  if (trimmedObjStr.startsWith("{") && trimmedObjStr.endsWith("}")) {
                    return parseObjectString(trimmedObjStr.substring(1, trimmedObjStr.length - 1));
                  }
                  throw new Error(`Invalid object format in hasitem array: ${objStr}`);
                });
                parsedItems = JSON.parse(`[${processedObjects.join(",")}]`);
              }
            } else if (valueToParse.startsWith("{")) {
              if (!valueToParse.endsWith("}")) throw new Error("Mismatched braces in hasitem object.");
              const objectContent = valueToParse.substring(1, valueToParse.length - 1);
              if (objectContent.trim() === "") {
                parsedItems = [{}];
              } else {
                parsedItems = [JSON.parse(parseObjectString(objectContent))];
              }
            } else {
              console.warn(
                `[EntitySelector] hasitem の値の形式が無効です。"{...}" または "[{...}]" 形式である必要があります: ${valueToParse}`
              );
              break;
            }
            if (Array.isArray(parsedItems)) {
              for (const itemCondition of parsedItems) {
                const filter: HasItemFilter = {};
                if (itemCondition.item !== undefined) filter.item = String(itemCondition.item);
                if (itemCondition.quantity !== undefined) {
                  filter.quantity = {};
                  const quantityStr = String(itemCondition.quantity);
                  if (typeof itemCondition.quantity === "number") {
                    filter.quantity = { min: itemCondition.quantity, max: itemCondition.quantity };
                  } else {
                    const rangeMatch = quantityStr.match(/^(-?\d+)?\.\.(-?\d+)?$/);
                    if (rangeMatch) {
                      if (rangeMatch[1]) filter.quantity.min = parseInt(rangeMatch[1], 10);
                      if (rangeMatch[2]) filter.quantity.max = parseInt(rangeMatch[2], 10);
                    } else {
                      const q = parseInt(quantityStr, 10);
                      if (!isNaN(q)) filter.quantity = { min: q, max: q };
                    }
                  }
                } else {
                  filter.quantity = { min: 1 };
                }
                if (itemCondition.data !== undefined) filter.data = parseInt(String(itemCondition.data), 10);
                if (itemCondition.location !== undefined) filter.location = String(itemCondition.location);
                if (itemCondition.slot !== undefined) {
                  filter.slot = {};
                  const slotStr = String(itemCondition.slot);
                  if (typeof itemCondition.slot === "number") {
                    filter.slot = { min: itemCondition.slot, max: itemCondition.slot };
                  } else {
                    const rangeMatch = slotStr.match(/^(-?\d+)?\.\.(-?\d+)?$/);
                    if (rangeMatch) {
                      if (rangeMatch[1]) filter.slot.min = parseInt(rangeMatch[1], 10);
                      if (rangeMatch[2]) filter.slot.max = parseInt(rangeMatch[2], 10);
                    } else {
                      const s = parseInt(slotStr, 10);
                      if (!isNaN(s)) filter.slot = { min: s, max: s };
                    }
                  }
                }
                this.hasItemFilters.push(filter);
              }
            }
          } catch (e: any) {
            console.warn(`[EntitySelector] hasitem 引数のJSONパースに失敗しました: ${trimmedValue}`, e.message || e);
          }
          break;
        default:
          console.warn(`[EntitySelector] 未サポートの引数: ${trimmedKey}`);
      }
    }
  }

  public getEntities(): Entity[] {
    let entities: Entity[] = [];
    const currentQuery: EntityQueryOptions = { ...this.queryOptions }; // scores はこの時点で currentQuery に入っている

    if (this.targetSelectorSymbol === "@s") {
      if (this.executor) {
        // @s に適用する EntityQueryOptions プロパティ (scoreOptions も API が処理)
        const queryForS: EntityQueryOptions = {
          type: currentQuery.type,
          excludeTypes: currentQuery.excludeTypes,
          name: currentQuery.name,
          tags: currentQuery.tags,
          excludeTags: currentQuery.excludeTags,
          families: currentQuery.families,
          excludeFamilies: currentQuery.excludeFamilies,
          gameMode: currentQuery.gameMode,
          minLevel: currentQuery.minLevel,
          maxLevel: currentQuery.maxLevel,
          scoreOptions: currentQuery.scoreOptions, // API に任せる
          minHorizontalRotation: currentQuery.minHorizontalRotation,
          maxHorizontalRotation: currentQuery.maxHorizontalRotation,
          minVerticalRotation: currentQuery.minVerticalRotation,
          maxVerticalRotation: currentQuery.maxVerticalRotation,
        };

        if (this._checkExecutorMatchesBaseQuery(this.executor, queryForS)) {
          let executorArray = [this.executor];
          // hasitemフィルター (これはカスタムのまま)
          if (this.hasItemFilters.length > 0) {
            executorArray = executorArray.filter((e) =>
              this.hasItemFilters.every((filter) => this._checkSingleEntityHasItem(e, filter))
            );
          }
          // @s[x=...,dx=...] のボリュームチェック (API の volume を利用)
          const volumeForS = currentQuery.volume;
          const locationForS = currentQuery.location;
          if (volumeForS && locationForS) {
            if (!this._isWithinVolume(this.executor.location, locationForS, volumeForS)) {
              executorArray = [];
            }
          }
          entities = executorArray;
        }
      } else {
        console.warn(`[EntitySelector] @s セレクターには実行者が必要です。`);
      }
      return entities;
    }

    // location の自動設定
    if (
      !currentQuery.location &&
      (currentQuery.minDistance !== undefined ||
        currentQuery.maxDistance !== undefined ||
        currentQuery.closest !== undefined ||
        currentQuery.farthest !== undefined ||
        currentQuery.volume !== undefined ||
        currentQuery.minHorizontalRotation !== undefined ||
        currentQuery.maxHorizontalRotation !== undefined ||
        currentQuery.minVerticalRotation !== undefined ||
        currentQuery.maxVerticalRotation !== undefined)
    ) {
      if (this.executionLocation) {
        currentQuery.location = this.executionLocation;
      }
    }

    if (this.targetSelectorSymbol === "@p") {
      currentQuery.type = "minecraft:player";
      currentQuery.closest = this.queryOptions.closest || 1;
    } else if (this.targetSelectorSymbol === "@a") {
      currentQuery.type = "minecraft:player";
    } else if (this.targetSelectorSymbol === "@r") {
      if (!currentQuery.type && !currentQuery.families && !currentQuery.tags && !currentQuery.name) {
        currentQuery.type = "minecraft:player";
      }
      delete currentQuery.closest;
      delete currentQuery.farthest;
    }

    entities = Array.from(this.executionDimension.getEntities(currentQuery)); // scoreOptions もここでAPIが処理

    // 後処理フィルター (hasitem のみ)
    if (this.hasItemFilters.length > 0) {
      entities = entities.filter((e) =>
        this.hasItemFilters.every((filter) => this._checkSingleEntityHasItem(e, filter))
      );
    }

    if (this.targetSelectorSymbol === "@r") {
      if (entities.length > 0) {
        const countArg = this.queryOptions.closest ?? this.queryOptions.farthest ?? 1;
        const count = Math.max(1, Math.abs(countArg));
        const result: Entity[] = [];
        const copy = [...entities];
        for (let i = 0; i < count && copy.length > 0; i++) {
          const randomIndex = Math.floor(Math.random() * copy.length);
          result.push(copy.splice(randomIndex, 1)[0]);
        }
        entities = result;
      }
    }
    return entities;
  }

  private _isWithinVolume(entityLocation: Vector3, volumeBaseLocation: Vector3, volumeDelta: Vector3): boolean {
    const x1 = volumeBaseLocation.x;
    const y1 = volumeBaseLocation.y;
    const z1 = volumeBaseLocation.z;
    const x2 = x1 + volumeDelta.x;
    const y2 = y1 + volumeDelta.y;
    const z2 = z1 + volumeDelta.z;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);
    const effectiveMaxX = volumeDelta.x === 0 ? minX + 1 : maxX;
    const effectiveMaxY = volumeDelta.y === 0 ? minY + 1 : maxY;
    const effectiveMaxZ = volumeDelta.z === 0 ? minZ + 1 : maxZ;
    return (
      entityLocation.x >= minX &&
      entityLocation.x < effectiveMaxX &&
      entityLocation.y >= minY &&
      entityLocation.y < effectiveMaxY &&
      entityLocation.z >= minZ &&
      entityLocation.z < effectiveMaxZ
    );
  }

  private _checkExecutorMatchesBaseQuery(entity: Entity, options: EntityQueryOptions): boolean {
    // EntityQueryOptions に scoreOptions が含まれるため、API側で処理されると仮定し、ここではチェックしない。
    // ただし、APIの getEntities が単一エンティティの scoreOptions を正しく評価するかは要確認。
    // 念のため、@s の scoreOptions は手動で _matchesScoreFilters を呼び出す方が確実かもしれない。
    // ここでは、APIが scoreOptions を EntityQueryOptions の一部として正しく扱うと期待する。

    if (options.type && entity.typeId !== options.type) return false;
    if (options.excludeTypes && options.excludeTypes.includes(entity.typeId)) return false;
    if (options.name && entity.nameTag !== options.name) return false;
    const entityTags = entity.getTags();
    if (options.tags && !options.tags.every((tag) => entityTags.includes(tag))) return false;
    if (options.excludeTags && options.excludeTags.some((tag) => entityTags.includes(tag))) return false;
    const familyComponent = entity.getComponent(EntityTypeFamilyComponent.componentId) as
      | EntityTypeFamilyComponent
      | undefined;
    if (options.families && !options.families.every((family) => familyComponent?.hasTypeFamily(family))) return false;
    if (options.excludeFamilies && options.excludeFamilies.some((family) => familyComponent?.hasTypeFamily(family)))
      return false;

    if (entity instanceof Player) {
      if (options.gameMode && entity.getGameMode() !== options.gameMode) return false;
      if (options.minLevel !== undefined && entity.level < options.minLevel) return false;
      if (options.maxLevel !== undefined && entity.level > options.maxLevel) return false;
    }

    const rotation = entity.getRotation();
    if (options.minHorizontalRotation !== undefined && rotation.y < options.minHorizontalRotation) return false;
    if (options.maxHorizontalRotation !== undefined && rotation.y > options.maxHorizontalRotation) return false;
    if (options.minVerticalRotation !== undefined && rotation.x < options.minVerticalRotation) return false;
    if (options.maxVerticalRotation !== undefined && rotation.x > options.maxVerticalRotation) return false;

    if (options.location) {
      const distSq = this._calculateDistanceSquared(entity.location, options.location);
      if (options.minDistance !== undefined && distSq < options.minDistance * options.minDistance) return false;
      if (options.maxDistance !== undefined && distSq > options.maxDistance * options.maxDistance) return false;
    }
    // scoreOptions のチェック (EntityQueryOptions に含まれているので、API側でのフィルタリングを期待)
    // ただし、@s の場合は dimension.getEntities を使わないので、ここでチェックするか、
    // getEntities の @s ブロックで _matchesScoreFilters を呼ぶ必要がある。
    // → getEntities の @s ブロックで _matchesScoreFilters を呼ぶ方が明示的。
    return true;
  }

  // _matchesScoreFilters は EntityQueryOptions.scoreOptions があるため不要になる想定だったが、
  // @s の場合や、APIの getEntities が scoreOptions を期待通りに処理しない可能性を考慮し、
  // カスタムフィルタとして残し、必要な箇所で呼び出す。
  private _matchesScoreFilters(entity: Entity, scoreFilters: EntityQueryScoreOptions[]): boolean {
    const scoreboardId = entity.scoreboardIdentity;
    if (!scoreboardId) return false; // スコアを持てないエンティティは不一致

    for (const filter of scoreFilters) {
      // filter.exclude はここでは考慮しない (コマンドセレクタの scores には通常ないため)
      // もし必要なら、filter.exclude が true の場合に条件を反転させるロジックを追加
      try {
        const objective = world.scoreboard.getObjective(filter.objective ?? ""); // Add null coalescing
        if (!objective) return false; // 存在しない目的は不一致

        const score = objective.getScore(scoreboardId); // スコアがない場合は undefined
        if (score === undefined && (filter.minScore !== undefined || filter.maxScore !== undefined)) {
          // スコアが存在しないが、範囲指定がある場合は不一致 (0点扱いとは異なる)
          return false;
        }
        if (score === undefined && filter.minScore === undefined && filter.maxScore === undefined) {
          // スコアが存在せず、範囲指定もない場合 (例: {objective=foo}) は、
          // コマンドの挙動としては「そのobjectiveに何らかのスコアが設定されていればOK」となることが多い。
          // ここでは、スコアがundefinedなら不一致とするのが安全か。
          // または、minScore/maxScoreがundefinedの場合、スコアの存在自体を問うのであればtrueとするか。
          // APIの EntityQueryScoreOptions の挙動に合わせるのがベスト。
          // ここでは、スコアが存在しない場合は、minScore/maxScoreが指定されていれば確実にfalseとする。
          // min/maxScore未指定で objective のみの場合の挙動は要確認。
          // Minecraft wiki "Target selectors" によると、
          // scores={foo=..} はfooにスコアを持つエンティティ、scores={foo=10} はfooが10のエンティティ。
          // scores={foo=} はエラー。
          // ここでは、スコアが存在しない場合は常に不一致としておくのが無難。
          return false;
        }
        if (score !== undefined) {
          // スコアが存在する場合のみ min/max を評価
          if (filter.minScore !== undefined && score < filter.minScore) return false;
          if (filter.maxScore !== undefined && score > filter.maxScore) return false;
        }
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  private _checkSingleEntityHasItem(entity: Entity, filter: HasItemFilter): boolean {
    // (変更なし)
    const inventory = entity.getComponent(EntityInventoryComponent.componentId) as EntityInventoryComponent | undefined;
    const equippable = entity.getComponent(EntityEquippableComponent.componentId) as
      | EntityEquippableComponent
      | undefined;
    const slotsToSearch: { itemStack: ItemStack | undefined; slotType: string; slotIndex: number }[] = [];

    if (inventory?.container) {
      for (let i = 0; i < inventory.container.size; i++) {
        const item = inventory.container.getItem(i);
        let slotType = "slot.inventory";
        if (entity instanceof Player) {
          if (i >= 0 && i <= 8) slotType = "slot.hotbar";
        }
        slotsToSearch.push({ itemStack: item, slotType: slotType, slotIndex: i });
      }
    }
    if (equippable) {
      for (const slotKey of Object.values(EquipmentSlot)) {
        const slotEnumKey = slotKey as string;
        const item = equippable.getEquipment(slotKey as any);
        let slotType = "";
        switch (slotKey) {
          case EquipmentSlot.Head:
            slotType = "slot.armor.head";
            break;
          case EquipmentSlot.Chest:
            slotType = "slot.armor.chest";
            break;
          case EquipmentSlot.Legs:
            slotType = "slot.armor.legs";
            break;
          case EquipmentSlot.Feet:
            slotType = "slot.armor.feet";
            break;
          case EquipmentSlot.Mainhand:
            slotType = "slot.weapon.mainhand";
            break;
          case EquipmentSlot.Offhand:
            slotType = "slot.weapon.offhand";
            break;
          default:
            slotType = `slot.equippable.${slotEnumKey.toLowerCase()}`;
            break;
        }
        slotsToSearch.push({ itemStack: item, slotType: slotType, slotIndex: -1 });
      }
    }
    for (const { itemStack, slotType, slotIndex } of slotsToSearch) {
      if (!itemStack) continue;
      let itemMatch = !filter.item;
      if (filter.item) {
        if (filter.item.startsWith("minecraft:")) {
          if (itemStack.typeId === filter.item) itemMatch = true;
        } else {
          if (itemStack.getTags().includes(filter.item)) itemMatch = true;
        }
      }
      if (!itemMatch) continue;
      let quantityMatch = !filter.quantity;
      if (filter.quantity) {
        const amount = itemStack.amount;
        const min = filter.quantity.min === undefined ? -Infinity : filter.quantity.min;
        const max = filter.quantity.max === undefined ? Infinity : filter.quantity.max;
        if (amount >= min && amount <= max) {
          quantityMatch = true;
        }
      }
      if (!quantityMatch) continue;
      let dataMatch = !filter.data || filter.data === -1;
      if (filter.data !== undefined && filter.data !== -1) {
        const durabilityComp = itemStack.getComponent(ItemComponentTypes.Durability) as
          | ItemDurabilityComponent
          | undefined;
        if (durabilityComp) {
          if (filter.data === durabilityComp.damage) dataMatch = true;
        } else {
          if (filter.data === 0) dataMatch = true;
        }
      }
      if (!dataMatch) continue;
      let locationAndSlotMatch = false;
      if (filter.location) {
        let matchesLocation = filter.location === slotType;
        if (filter.location === "slot.inventory" && (slotType === "slot.hotbar" || slotType === "slot.inventory")) {
          matchesLocation = true;
        }
        if (matchesLocation) {
          if (filter.slot && slotIndex !== -1) {
            const sMin = filter.slot.min === undefined ? -Infinity : filter.slot.min;
            const sMax = filter.slot.max === undefined ? Infinity : filter.slot.max;
            if (slotIndex >= sMin && slotIndex <= sMax) locationAndSlotMatch = true;
          } else if (
            filter.slot &&
            slotIndex === -1 &&
            (slotType.startsWith("slot.armor.") || slotType.startsWith("slot.weapon."))
          ) {
            locationAndSlotMatch = true;
          } else if (!filter.slot) {
            locationAndSlotMatch = true;
          }
        }
      } else if (filter.slot && slotIndex !== -1) {
        const sMin = filter.slot.min === undefined ? -Infinity : filter.slot.min;
        const sMax = filter.slot.max === undefined ? Infinity : filter.slot.max;
        if (slotIndex >= sMin && slotIndex <= sMax) locationAndSlotMatch = true;
      } else if (!filter.location && !filter.slot) {
        locationAndSlotMatch = true;
      }
      if (!locationAndSlotMatch) continue;
      return true;
    }
    return false;
  }

  private _calculateDistanceSquared(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  }
}
