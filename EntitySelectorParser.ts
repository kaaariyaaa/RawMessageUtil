import {
  world,
  Dimension,
  Entity,
  EntityQueryOptions,
  GameMode,
  Vector3,
  Player,
  // ScoreboardIdentity, // 必要に応じてコメント解除
  // ScoreboardObjective, // 必要に応じてコメント解除
  ItemStack,
  EntityInventoryComponent,
  EntityEquippableComponent,
  EquipmentSlot,
  ItemDurabilityComponent,
  ItemComponentTypes,
  EntityTypeFamilyComponent, // 追加
  // ContainerSlot // 直接は使用していませんが、ItemStackなどが内部で利用する可能性あり
} from "@minecraft/server";

// EntityQueryOptionsにscoreOptionsを追加するための拡張インターフェース
interface EntityQueryOptionsEx extends EntityQueryOptions {
  scoreOptions?: ScoreFilter[];
}

// スコアフィルターの条件
interface ScoreFilter {
  objective: string;
  minScore?: number;
  maxScore?: number;
}

// hasitemフィルターの条件
interface HasItemFilter {
  item?: string;
  quantity?: { min?: number; max?: number };
  data?: number; // Script APIでの完全なマッチングは困難
  location?: string;
  slot?: { min?: number; max?: number };
}

export class EntitySelector {
  private readonly selectorString: string;
  private readonly executionDimension: Dimension;
  private readonly executionLocation?: Vector3;
  private readonly executor?: Entity;

  private targetSelectorSymbol: string; // 初期値はパース時に設定
  private queryOptions: EntityQueryOptionsEx = {};
  private hasItemFilters: HasItemFilter[] = [];

  /**
   * EntitySelectorのインスタンスを作成します。
   * @param selectorString コマンドセレクター文字列 (例: "@e[type=minecraft:pig,tag=friendly]")
   * @param executionDimension コマンドが実行されるディメンション
   * @param executionLocation コマンドが実行される場所 (省略可能、@p や座標フィルターで使用)
   * @param executor コマンド実行者 (省略可能、@s で使用)
   */
  constructor(selectorString: string, executionDimension: Dimension, executionLocation?: Vector3, executor?: Entity) {
    this.selectorString = selectorString;
    this.executionDimension = executionDimension;
    this.executionLocation = executionLocation || executor?.location;
    this.executor = executor;

    // targetSelectorSymbol は _parseSelectorString で初期化される
    this.targetSelectorSymbol = "@e"; // デフォルト/フォールバック
    this._parseSelectorString();
  }

  private _parseSelectorString(): void {
    const selectorMatch = this.selectorString.match(/^(@[parse])(?:\[(.*?)\])?$/);
    if (!selectorMatch) {
      console.warn(
        `[EntitySelector] 無効なセレクター形式です: ${this.selectorString}. デフォルトの "@e" を使用します。`
      );
      // 引数がない場合はここで終了
      if (!this.selectorString.includes("[")) return;

      // @ がないが引数がある場合 (例: [type=player]) -> @e とみなす
      const argsOnlyMatch = this.selectorString.match(/^\[(.*?)\]$/);
      if (argsOnlyMatch) {
        this.targetSelectorSymbol = "@e"; // 暗黙的に @e
        const argsString = argsOnlyMatch[1];
        if (argsString) {
          this._parseArguments(argsString);
        }
      }
      return;
    }

    this.targetSelectorSymbol = selectorMatch[1]; // @p, @a, @r, @s, @e
    const argsString = selectorMatch[2];

    if (argsString) {
      this._parseArguments(argsString);
    }
  }

  private _parseArguments(argsString: string): void {
    const args: string[] = [];
    let currentArg = "";
    let inBraces = 0; // {} のネストレベル
    let inSquareBrackets = 0; // [] のネストレベル (hasitem=[{...}] のため)

    for (let i = 0; i < argsString.length; i++) {
      const char = argsString[i];
      currentArg += char;

      if (char === "{") inBraces++;
      else if (char === "}") inBraces--;
      else if (char === "[") inSquareBrackets++;
      else if (char === "]") inSquareBrackets--;
      else if (char === "," && inBraces === 0 && inSquareBrackets === 0) {
        args.push(currentArg.slice(0, -1).trim()); // 末尾のカンマを除去して追加
        currentArg = "";
      }
    }
    args.push(currentArg.trim()); // 最後の引数を追加

    for (const arg of args) {
      if (!arg) continue;
      const [key, ...valueParts] = arg.split("=");
      const value = valueParts.join("=").trim(); // 値に '=' が含まれる場合を考慮

      if (!key || value === undefined) {
        console.warn(`[EntitySelector] 無効な引数形式: ${arg} (セレクター: ${this.selectorString})`);
        continue;
      }
      const trimmedKey = key.trim();
      let trimmedValue = value.replace(/^"|"$/g, ""); // 前後のクォーテーション除去

      // 各キーに対応する処理 (前回と同様)
      switch (trimmedKey) {
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
        case "x":
        case "y":
        case "z":
          if (!this.queryOptions.location) {
            // executionLocation がない場合、デフォルトの(0,0,0)を基準とするか、エラーとするか
            // ここでは executionLocation があればそれを使用し、なければ引数で指定された値をそのまま使う
            this.queryOptions.location = {
              x: trimmedKey === "x" ? parseFloat(trimmedValue) : this.executionLocation?.x ?? 0,
              y: trimmedKey === "y" ? parseFloat(trimmedValue) : this.executionLocation?.y ?? 0,
              z: trimmedKey === "z" ? parseFloat(trimmedValue) : this.executionLocation?.z ?? 0,
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
        case "m":
          this.queryOptions.gameMode = trimmedValue as GameMode;
          break;
        case "l":
          this.queryOptions.maxLevel = parseInt(trimmedValue, 10);
          break;
        case "lm":
          this.queryOptions.minLevel = parseInt(trimmedValue, 10);
          break;
        case "scores":
          if (trimmedValue.startsWith("{") && trimmedValue.endsWith("}")) {
            const scoreArgs = trimmedValue.substring(1, trimmedValue.length - 1).split(",");
            if (!this.queryOptions.scoreOptions) this.queryOptions.scoreOptions = [];
            for (const scoreArg of scoreArgs) {
              const [objName, scoreValStr] = scoreArg.split("=");
              if (objName && scoreValStr) {
                const scoreFilter: ScoreFilter = { objective: objName.trim() };
                const rangeMatch = scoreValStr.trim().match(/^(-?\d+)?\.\.(-?\d+)?$/);
                if (rangeMatch) {
                  if (rangeMatch[1]) scoreFilter.minScore = parseInt(rangeMatch[1], 10);
                  if (rangeMatch[2]) scoreFilter.maxScore = parseInt(rangeMatch[2], 10);
                } else {
                  const exactScore = parseInt(scoreValStr.trim(), 10);
                  if (!isNaN(exactScore)) {
                    scoreFilter.minScore = exactScore;
                    scoreFilter.maxScore = exactScore;
                  }
                }
                if (scoreFilter.minScore !== undefined || scoreFilter.maxScore !== undefined) {
                  this.queryOptions.scoreOptions.push(scoreFilter);
                }
              }
            }
          }
          break;
        case "hasitem":
          try {
            let jsonCompliantValue = trimmedValue
              .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":') // item: -> "item":
              .replace(
                /:\s*(?!true|false|-?\d+\.?\d*|{|\[|")(.*?)([,}\]])/g,
                (match, p1, p2) => `: "${p1.trim().replace(/"/g, '\\"')}"${p2}`
              ) // : value -> : "value"
              .replace(
                /:\s*(?!true|false|-?\d+\.?\d*|{|\[|")(.*?)$/g,
                (match, p1) => `: "${p1.trim().replace(/"/g, '\\"')}"`
              ); //末尾の : value

            let parsedItems: any;
            if (jsonCompliantValue.startsWith("[")) {
              parsedItems = JSON.parse(jsonCompliantValue);
            } else if (jsonCompliantValue.startsWith("{")) {
              parsedItems = [JSON.parse(jsonCompliantValue)];
            } else {
              console.warn(`[EntitySelector] hasitem の値の形式が無効です: ${trimmedValue}`);
              break;
            }

            if (Array.isArray(parsedItems)) {
              for (const itemCondition of parsedItems) {
                const filter: HasItemFilter = {};
                if (itemCondition.item !== undefined) filter.item = String(itemCondition.item);

                if (itemCondition.quantity !== undefined) {
                  filter.quantity = {};
                  if (typeof itemCondition.quantity === "number") {
                    filter.quantity = { min: itemCondition.quantity, max: itemCondition.quantity };
                  } else if (typeof itemCondition.quantity === "string") {
                    const rangeMatch = itemCondition.quantity.match(/^(-?\d+)?\.\.(-?\d+)?$/);
                    if (rangeMatch) {
                      if (rangeMatch[1]) filter.quantity.min = parseInt(rangeMatch[1], 10);
                      if (rangeMatch[2]) filter.quantity.max = parseInt(rangeMatch[2], 10);
                    } else {
                      const q = parseInt(itemCondition.quantity, 10);
                      if (!isNaN(q)) filter.quantity = { min: q, max: q };
                    }
                  }
                } else {
                  // quantity指定なしは 1.. と同じ
                  filter.quantity = { min: 1 };
                }

                if (itemCondition.data !== undefined) filter.data = parseInt(itemCondition.data, 10);
                if (itemCondition.location !== undefined) filter.location = String(itemCondition.location);

                if (itemCondition.slot !== undefined) {
                  filter.slot = {};
                  if (typeof itemCondition.slot === "number") {
                    filter.slot = { min: itemCondition.slot, max: itemCondition.slot };
                  } else if (typeof itemCondition.slot === "string") {
                    const rangeMatch = itemCondition.slot.match(/^(-?\d+)?\.\.(-?\d+)?$/);
                    if (rangeMatch) {
                      if (rangeMatch[1]) filter.slot.min = parseInt(rangeMatch[1], 10);
                      if (rangeMatch[2]) filter.slot.max = parseInt(rangeMatch[2], 10);
                    } else {
                      const s = parseInt(itemCondition.slot, 10);
                      if (!isNaN(s)) filter.slot = { min: s, max: s };
                    }
                  }
                }
                this.hasItemFilters.push(filter);
              }
            }
          } catch (e) {
            console.warn(`[EntitySelector] hasitem 引数のJSONパースに失敗しました: ${trimmedValue}`, e);
          }
          break;
        default:
          console.warn(
            `[EntitySelector] サポートされていない引数です: ${trimmedKey} (セレクター: ${this.selectorString})`
          );
      }
    }
  }

  public getEntities(): Entity[] {
    let entities: Entity[] = [];
    const baseQuery: EntityQueryOptions = { ...this.queryOptions };
    delete (baseQuery as any).scoreOptions; // scoreOptionsはgetEntitiesの引数ではないため除外

    switch (this.targetSelectorSymbol) {
      case "@s":
        if (this.executor) {
          entities = [this.executor].filter((e) => this._matchesManualFilters(e, this.queryOptions));
        } else {
          console.warn(`[EntitySelector] @s セレクターには実行者 (executor) が必要です。`);
        }
        break;
      case "@p":
        baseQuery.type = "minecraft:player";
        if (this.executionLocation) {
          baseQuery.location = this.executionLocation;
        }
        baseQuery.closest = this.queryOptions.closest || 1; // c が指定されていなければ1
        entities = this.executionDimension.getEntities(baseQuery);
        break;
      case "@a":
        baseQuery.type = "minecraft:player";
        entities = this.executionDimension.getEntities(baseQuery);
        break;
      case "@r":
        if (!baseQuery.type) baseQuery.type = "minecraft:player";
        let allMatching = this.executionDimension.getEntities(baseQuery);
        if (this.queryOptions.scoreOptions && this.queryOptions.scoreOptions.length > 0) {
          allMatching = allMatching.filter((e) => this._matchesScoreFilters(e, this.queryOptions.scoreOptions!));
        }
        if (allMatching.length > 0) {
          const count = this.queryOptions.closest || 1; // c引数があればその数、なければ1
          for (let i = 0; i < count && allMatching.length > 0; i++) {
            const randomIndex = Math.floor(Math.random() * allMatching.length);
            entities.push(allMatching.splice(randomIndex, 1)[0]);
          }
        }
        break;
      case "@e":
      default:
        entities = this.executionDimension.getEntities(baseQuery);
        // scoresはgetEntitiesで直接フィルタできないので後処理
        if (this.queryOptions.scoreOptions && this.queryOptions.scoreOptions.length > 0) {
          entities = entities.filter((e) => this._matchesScoreFilters(e, this.queryOptions.scoreOptions!));
        }
        break;
    }

    // volume フィルタリング (getEntitiesのオプションにvolumeがないため後処理)
    if (this.queryOptions.volume && this.queryOptions.location) {
      entities = this._filterByVolume(entities, this.queryOptions.location, this.queryOptions.volume);
    }

    // hasitem フィルタリング
    if (this.hasItemFilters.length > 0) {
      entities = entities.filter((entity) => {
        return this.hasItemFilters.every((filter) => this._checkSingleEntityHasItem(entity, filter));
      });
    }
    return entities;
  }

  private _matchesManualFilters(entity: Entity, options: EntityQueryOptionsEx): boolean {
    // typeId, nameTag, tags, families の基本的なチェック
    if (options.type && entity.typeId !== options.type) return false;
    if (options.excludeTypes && options.excludeTypes.includes(entity.typeId)) return false;
    if (options.name && entity.nameTag !== options.name) return false;

    const entityTags = entity.getTags();
    if (options.tags) {
      for (const tag of options.tags) {
        if (!entityTags.includes(tag)) return false;
      }
    }
    if (options.excludeTags) {
      for (const tag of options.excludeTags) {
        if (entityTags.includes(tag)) return false;
      }
    }

    const familyComponent = entity.getComponent(EntityTypeFamilyComponent.componentId) as
      | EntityTypeFamilyComponent
      | undefined;
    if (options.families) {
      for (const family of options.families) {
        if (!familyComponent?.hasTypeFamily(family)) return false;
      }
    }
    if (options.excludeFamilies) {
      for (const family of options.excludeFamilies) {
        if (familyComponent?.hasTypeFamily(family)) return false;
      }
    }

    // gameMode (Playerのみ)
    if (options.gameMode && entity instanceof Player) {
      if (entity.getGameMode() !== options.gameMode) return false;
    }
    // level (Playerのみ)
    if (entity instanceof Player) {
      if (options.minLevel !== undefined && entity.level < options.minLevel) return false;
      if (options.maxLevel !== undefined && entity.level > options.maxLevel) return false;
    }

    // scoreOptions
    if (options.scoreOptions && options.scoreOptions.length > 0) {
      if (!this._matchesScoreFilters(entity, options.scoreOptions)) return false;
    }

    // location, distance は getEntities での絞り込みに任せるか、ここでさらに厳密に評価
    if (options.location) {
      const distSq = this._calculateDistanceSquared(entity.location, options.location);
      if (options.minDistance !== undefined && distSq < options.minDistance * options.minDistance) return false;
      if (options.maxDistance !== undefined && distSq > options.maxDistance * options.maxDistance) return false;
    }

    return true;
  }
  private _matchesScoreFilters(entity: Entity, scoreFilters: ScoreFilter[]): boolean {
    const scoreboardId = entity.scoreboardIdentity;
    if (!scoreboardId) return false; // スコアを持てないエンティティ

    for (const filter of scoreFilters) {
      try {
        const objective = world.scoreboard.getObjective(filter.objective);
        if (!objective) return false; // 指定された目的が存在しない

        const score = objective.getScore(scoreboardId);
        if (score === undefined) return false; // その目的でスコアが設定されていない

        if (filter.minScore !== undefined && score < filter.minScore) return false;
        if (filter.maxScore !== undefined && score > filter.maxScore) return false;
      } catch (e) {
        // getObjectiveなどがエラーを出す可能性を考慮
        // console.warn(`Error checking score for objective ${filter.objective}:`, e);
        return false;
      }
    }
    return true;
  }

  private _filterByVolume(entities: Entity[], location: Vector3, volume: Vector3): Entity[] {
    return entities.filter((entity) => {
      const el = entity.location;
      // コマンドのdx,dy,dzは常に正の方向へのオフセットとして扱われることが多いが、
      // EntityQueryOptionsのvolumeは単純なサイズなので、基準点からの相対位置で見る
      const minX = Math.min(location.x, location.x + volume.x);
      const maxX = Math.max(location.x, location.x + volume.x);
      const minY = Math.min(location.y, location.y + volume.y);
      const maxY = Math.max(location.y, location.y + volume.y);
      const minZ = Math.min(location.z, location.z + volume.z);
      const maxZ = Math.max(location.z, location.z + volume.z);

      // volumeの各要素が0の場合、その軸では1ブロック分の範囲とみなす
      const effectiveMaxX = volume.x === 0 ? minX + 1 : maxX;
      const effectiveMaxY = volume.y === 0 ? minY + 1 : maxY;
      const effectiveMaxZ = volume.z === 0 ? minZ + 1 : maxZ;

      return (
        el.x >= minX &&
        el.x < effectiveMaxX &&
        el.y >= minY &&
        el.y < effectiveMaxY &&
        el.z >= minZ &&
        el.z < effectiveMaxZ
      );
    });
  }

  private _checkSingleEntityHasItem(entity: Entity, filter: HasItemFilter): boolean {
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
          const container = inventory.container;
          // プレイヤーのインベントリスロット番号: 0-8 ホットバー, 9-35 メインインベントリ, 36-39 鎧, 40 オフハンド
          // Script APIのcontainer.sizeは通常ホットバー+メインインベントリ(36)
          if (i >= 0 && i <= 8) slotType = "slot.hotbar";
        }
        slotsToSearch.push({ itemStack: item, slotType: slotType, slotIndex: i });
      }
    }

    if (equippable) {
      for (const slotKey of Object.values(EquipmentSlot)) {
        // Enumの値を直接イテレート
        const item = equippable.getEquipment(slotKey);
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
            slotType = `slot.equippable.${slotKey.toLowerCase()}`; // その他の装備スロット（例：馬の鎧）
        }
        slotsToSearch.push({ itemStack: item, slotType: slotType, slotIndex: -1 });
      }
    }

    for (const { itemStack, slotType, slotIndex } of slotsToSearch) {
      if (!itemStack) continue;

      if (filter.item && itemStack.typeId !== filter.item && !itemStack.getTags().includes(filter.item)) {
        // アイテムタグも考慮
        // minecraft:wool と wool (タグ) のようなケース
        if (filter.item.startsWith("minecraft:")) {
          // ID指定の場合
          if (itemStack.typeId !== filter.item) continue;
        } else {
          // タグ指定の場合
          if (!itemStack.getTags().includes(filter.item)) continue;
        }
      }

      if (filter.quantity) {
        const amount = itemStack.amount;
        if (filter.quantity.min !== undefined && amount < filter.quantity.min) continue;
        if (filter.quantity.max !== undefined && amount > filter.quantity.max) continue;
      }

      if (filter.data !== undefined && filter.data !== -1) {
        const durabilityComp = itemStack.getComponent(ItemComponentTypes.Durability) as
          | ItemDurabilityComponent
          | undefined;
        if (durabilityComp) {
          if (filter.data === 0 && durabilityComp.damage !== 0) continue;
          if (filter.data > 0 && durabilityComp.damage !== filter.data) continue;
        } else if (filter.data !== 0) {
          continue;
        }
      }

      let locationAndSlotMatch = false;
      if (filter.location) {
        if (filter.location === slotType) {
          if (filter.slot && slotIndex !== -1) {
            // スロット番号も指定されている場合
            const sMin = filter.slot.min;
            const sMax = filter.slot.max;
            if (sMin !== undefined && sMax !== undefined) {
              if (slotIndex >= sMin && slotIndex <= sMax) locationAndSlotMatch = true;
            } else if (sMin !== undefined) {
              if (slotIndex >= sMin) locationAndSlotMatch = true;
            } else if (sMax !== undefined) {
              if (slotIndex <= sMax) locationAndSlotMatch = true;
            }
          } else if (filter.slot && slotIndex === -1) {
            // 装備スロットなどでslotIndexがないが、locationが一致
            locationAndSlotMatch = true;
          } else if (!filter.slot) {
            // locationのみ指定
            locationAndSlotMatch = true;
          }
        }
        // "slot.inventory" はホットバーも含む
        if (filter.location === "slot.inventory" && (slotType === "slot.hotbar" || slotType === "slot.inventory")) {
          locationAndSlotMatch = true; // locationは一致、slotのチェックは上記に委ねる
          if (filter.slot && slotIndex !== -1) {
            const sMin = filter.slot.min;
            const sMax = filter.slot.max;
            let slotRangeMatch = false;
            if (sMin !== undefined && sMax !== undefined) {
              if (slotIndex >= sMin && slotIndex <= sMax) slotRangeMatch = true;
            } else if (sMin !== undefined) {
              // 単一指定または最小指定
              if (slotIndex >= sMin) slotRangeMatch = true;
            } else if (sMax !== undefined) {
              // 最大指定
              if (slotIndex <= sMax) slotRangeMatch = true;
            } else {
              // slot指定はあるが範囲がない場合は、locationのみで判断
              slotRangeMatch = true;
            }
            if (!slotRangeMatch) locationAndSlotMatch = false;
          }
        }
      } else if (filter.slot && slotIndex !== -1) {
        // location指定なし、slot指定あり
        const sMin = filter.slot.min;
        const sMax = filter.slot.max;
        if (sMin !== undefined && sMax !== undefined) {
          if (slotIndex >= sMin && slotIndex <= sMax) locationAndSlotMatch = true;
        } else if (sMin !== undefined) {
          // 単一指定または最小指定
          if (slotIndex >= sMin) locationAndSlotMatch = true;
        } else if (sMax !== undefined) {
          // 最大指定
          if (slotIndex <= sMax) locationAndSlotMatch = true;
        }
      } else if (!filter.location && !filter.slot) {
        // locationもslotも指定なし
        locationAndSlotMatch = true;
      }

      if (!locationAndSlotMatch) continue;

      return true; // 全てのhasitem内の条件に一致
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

// --- 使用例 ---
const overworld = world.getDimension("overworld");
const players = world.getAllPlayers();
let testPlayer: Player | undefined = undefined;
let testLocation: Vector3 | undefined = undefined;

if (players.length > 0) {
  testPlayer = players[0];
  testLocation = testPlayer.location;

  console.log("--- EntitySelector Class Tests (targetSelectorSymbol in selectorString) ---");

  // テスト1: 全ての豚 (セレクター文字列に @e を含む)
  const pigSelector = new EntitySelector("@e[type=minecraft:pig]", overworld, testLocation);
  const pigs = pigSelector.getEntities();
  console.log(`Pigs found: ${pigs.length}`);

  // テスト2: 引数のみ (暗黙的に @e)
  const allPlayersImplicit = new EntitySelector("[type=minecraft:player]", overworld, testLocation);
  const allPlayersImp = allPlayersImplicit.getEntities();
  console.log(`All players (implicit @e): ${allPlayersImp.length}`);

  // テスト3: "friendly" タグを持ち、"hostile" タグを持たないエンティティ
  const friendlySelector = new EntitySelector("@e[tag=friendly,tag=!hostile]", overworld);
  const friendlyEntities = friendlySelector.getEntities();
  console.log(`Friendly (not hostile) entities: ${friendlyEntities.length}`);

  // テスト4: スコア "level" が 5 以上 10 以下のプレイヤー (実行コンテキストを指定)
  // 事前に "level" objective を作成し、プレイヤーにスコアを設定しておく
  // world.scoreboard.addObjective("level", "Level");
  // testPlayer.scoreboardIdentity?.setScore(world.scoreboard.getObjective("level")!, 7);
  if (testPlayer && testLocation) {
    const levelPlayerSelector = new EntitySelector("@a[scores={level=5..10}]", overworld, testLocation, testPlayer);
    const levelPlayers = levelPlayerSelector.getEntities();
    console.log(`Players with level 5-10: ${levelPlayers.length}`);
    levelPlayers.forEach((p) => {
      if (p instanceof Player) {
        console.log(`  - ${p.nameTag} (Level: ${p.level})`);
      }
    });
  }

  // テスト5: ホットバーの2番目のスロット(インデックス1)に松明(minecraft:torch)を丁度1つ持ち、
  // かつダイヤモンドをインベントリ全体で3つ以上持っているプレイヤー
  // このテストのためには、プレイヤーが松明とダイヤモンドを適切に所持している必要があります。
  if (testPlayer && testLocation) {
    // (testPlayer.getComponent("inventory") as EntityInventoryComponent).container.setItem(1, new ItemStack("minecraft:torch", 1));
    // (testPlayer.getComponent("inventory") as EntityInventoryComponent).container.addItem(new ItemStack("minecraft:diamond", 3));
    const complexItemSelector = new EntitySelector(
      '@a[hasitem=[{item=minecraft:torch,quantity=1,location="slot.hotbar",slot=1},{item=minecraft:diamond,quantity=3..}]]',
      overworld,
      testLocation,
      testPlayer
    );
    const complexItemPlayers = complexItemSelector.getEntities();
    console.log(`Players with 1 torch in hotbar[1] AND >=3 diamonds: ${complexItemPlayers.length}`);
  }
} else {
  console.warn("EntitySelectorのテストには、ワールドに少なくとも1人のプレイヤーが必要です。");
}
