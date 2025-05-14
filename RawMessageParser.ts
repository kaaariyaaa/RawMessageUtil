import {
  world,
  Dimension,
  Entity,
  Block,
  Vector3,
  ScoreboardIdentity, // スコアボードIDを扱うために必要
  // ScoreboardObjective, // world.scoreboard.getObjective が返す型
} from "@minecraft/server";
import { EntitySelector } from "./EntitySelectorParser"; // EntitySelectorParser.ts が同じ階層にあると仮定

// RawMessageの型定義 (server.d.ts や common.d.ts を参照)
// 簡易的なものをここに定義しますが、実際のプロジェクトでは公式の型を参照してください。
interface RawMessage {
  text?: string;
  translate?: string;
  with?: string[] | RawMessage;
  score?: RawMessageScore;
  selector?: string;
  rawtext?: RawMessage[]; // ネストされたrawtextを処理するため
}

interface RawMessageScore {
  name: string;
  objective: string;
  value?: string; // これは通常出力時には使用されませんが、入力として存在しうる
}

interface RawText {
  rawtext?: RawMessage[];
}

export class RawTextParser {
  /**
   * RawMessage、RawMessage の配列、RawText オブジェクト、または rawText形式のJSON文字列をプレーンテキストに変換します。
   * @param rawInput 変換する RawMessage、RawMessage の配列、RawText オブジェクト、または rawText形式のJSON文字列。
   * @param executionSource オプション。セレクタの解決やスコア取得の基準となるエンティティ、ブロック、またはディメンション。
   * Player や Entity を渡すと、そのエンティティの位置やスコアが基準になります。
   * Dimension のみを渡した場合、セレクタの @s, @p などは解決が困難になります。
   * @returns 変換されたプレーンテキスト文字列。
   */
  public static parse(
    rawInput: RawMessage | RawMessage[] | RawText | string | undefined,
    executionSource?: Entity | Block | Dimension | Vector3
  ): string {
    if (!rawInput) {
      return "";
    }

    let parsedObject: RawMessage | RawMessage[] | RawText | undefined;
    if (typeof rawInput === "string") {
      try {
        parsedObject = JSON.parse(rawInput) as RawMessage | RawMessage[] | RawText;
      } catch (error) {
        // JSONパースに失敗した場合は、カラーコードを除去してそのまま返す
        return rawInput.replace(/§[0-9a-fk-or]/g, "");
      }
    } else {
      parsedObject = rawInput;
    }

    if (!parsedObject) {
      return "";
    }

    let currentDimension: Dimension | undefined;
    let currentLocation: Vector3 | undefined;
    let currentExecutor: Entity | undefined;

    if (executionSource) {
      if (executionSource instanceof Dimension) {
        currentDimension = executionSource;
      } else if (executionSource instanceof Block) {
        currentDimension = executionSource.dimension;
        currentLocation = executionSource.location;
      } else if (executionSource instanceof Entity) {
        currentDimension = executionSource.dimension;
        currentLocation = executionSource.location;
        currentExecutor = executionSource;
      } else if (
        typeof executionSource === "object" &&
        "x" in executionSource &&
        "y" in executionSource &&
        "z" in executionSource
      ) {
        currentLocation = executionSource;
        // Vector3 の場合、Dimensionが不明なためセレクタ解決に限界がある
        // フォールバックとして overworld を使用 (状況に応じて変更)
        currentDimension = world.getDimension("overworld");
      }
    }
    // executionSource が未指定の場合、world.overworld をフォールバックとして使用
    if (!currentDimension) {
      currentDimension = world.getDimension("overworld");
    }

    if (Array.isArray(parsedObject)) {
      return parsedObject
        .map((msg) => RawTextParser.parseSingleMessage(msg, currentDimension, currentLocation, currentExecutor))
        .join("");
    } else if (typeof parsedObject === "object" && "rawtext" in parsedObject && Array.isArray(parsedObject.rawtext)) {
      return (parsedObject as RawText)
        .rawtext!.map((msg) =>
          RawTextParser.parseSingleMessage(msg, currentDimension, currentLocation, currentExecutor)
        )
        .join("");
    } else if (typeof parsedObject === "object" && !Array.isArray(parsedObject)) {
      return RawTextParser.parseSingleMessage(
        parsedObject as RawMessage,
        currentDimension,
        currentLocation,
        currentExecutor
      );
    } else {
      // 配列でもオブジェクトでもない場合は文字列として扱う (カラーコード除去)
      return String(parsedObject).replace(/§[0-9a-fk-or]/g, "");
    }
  }

  /**
   * 単一の RawMessage オブジェクトをプレーンテキストに変換します。
   * @param message 変換する RawMessage オブジェクト。
   * @param dimension セレクタやスコア解決のためのディメンション。
   * @param location セレクタ解決のための基準位置。
   * @param executor セレクタ解決のための実行者エンティティ。
   * @returns 変換されたプレーンテキスト文字列。
   */
  private static parseSingleMessage(
    message: RawMessage,
    dimension?: Dimension,
    location?: Vector3,
    executor?: Entity
  ): string {
    let result = "";

    if (message.text) {
      result += message.text.replace(/§[0-9a-fk-or]/g, "");
    } else if (message.translate) {
      // 翻訳キーの簡易表示（実際の翻訳はここでは行わない）
      let translatedText = `[${message.translate}]`;
      if (message.with) {
        const withValues = Array.isArray(message.with)
          ? message.with
              .map((val) =>
                typeof val === "string" ? val : RawTextParser.parseSingleMessage(val, dimension, location, executor)
              )
              .join(", ")
          : RawTextParser.parseSingleMessage(message.with, dimension, location, executor); // withがRawMessageの場合
        translatedText = `[${message.translate} with (${withValues})]`;
      }
      result += translatedText;
    } else if (message.score && message.score.name && message.score.objective && dimension) {
      // --- score の処理を修正 ---
      const scoreInfo = message.score;
      let scoreHolderName = scoreInfo.name; // 表示用の名前を保持
      let scoreValueText = ""; // デフォルトは空文字や"0"などが考えられる

      try {
        const objective = world.scoreboard.getObjective(scoreInfo.objective);
        if (objective) {
          let targetIdentity: ScoreboardIdentity | undefined = undefined;

          if (scoreHolderName === "*") {
            // ワイルドカードは実行者自身
            if (executor && executor.scoreboardIdentity) {
              targetIdentity = executor.scoreboardIdentity;
              scoreHolderName = executor.nameTag || executor.typeId; // 表示名を更新
            } else {
              // 実行者コンテキストがない場合はスコア取得不可。空文字または代替値を返す
              scoreValueText = "0"; // 例として0
            }
          } else if (scoreHolderName.startsWith("@")) {
            // セレクターの場合
            const selector = new EntitySelector(scoreHolderName, dimension, location, executor);
            const selectedEntities = selector.getEntities();
            if (selectedEntities.length > 0 && selectedEntities[0].scoreboardIdentity) {
              targetIdentity = selectedEntities[0].scoreboardIdentity;
              scoreHolderName = selectedEntities[0].nameTag || selectedEntities[0].typeId; // 表示名を更新
            } else {
              // セレクターに一致するエンティティがいない場合
              scoreValueText = "0"; // 例として0
            }
          } else {
            // 特定のプレイヤー名またはフェイクプレイヤー名
            const participants = world.scoreboard.getParticipants();
            const foundParticipant = participants.find((p) => p.displayName === scoreHolderName);
            if (foundParticipant) {
              targetIdentity = foundParticipant;
            } else {
              // 存在しない参加者の場合 (フェイクプレイヤーも含む)
              // フェイクプレイヤーIDから直接 ScoreboardIdentity を取得する方法は現状提供されていないため、
              // displayNameでの検索に失敗した場合は、その名前のスコアは存在しないとみなすか、
              // もし `value` が rawMessage に指定されていればそれを使用することも検討できる。
              // ここでは displayName のみで判断し、なければ0とする。
              scoreValueText = "0"; // 例として0
            }
          }

          if (targetIdentity) {
            const score = objective.getScore(targetIdentity);
            if (score !== undefined) {
              scoreValueText = String(score);
            } else {
              // スコアが設定されていない場合
              scoreValueText = "0"; // 例として0
            }
          }
        } else {
          // 目的が存在しない場合
          scoreValueText = "0"; // 例として0
        }
      } catch (e) {
        console.warn(`Error retrieving score for ${scoreInfo.name} on ${scoreInfo.objective}: ${e}`);
        scoreValueText = "0"; // エラー時も0とする例
      }
      result += scoreValueText;
      // --- score の処理修正ここまで ---
    } else if (message.selector && dimension) {
      // --- selector の処理を修正 ---
      const selectorStr = message.selector;
      try {
        const selector = new EntitySelector(selectorStr, dimension, location, executor);
        const selectedEntities = selector.getEntities();
        if (selectedEntities.length > 0) {
          // エンティティのIDをカンマ区切りで結合
          result += selectedEntities.map((e) => e.id).join(", ");
        } else {
          // セレクタに一致するエンティティがいない場合は空文字
          result += "";
        }
      } catch (e) {
        console.warn(`Error resolving selector ${selectorStr}: ${e}`);
        result += ""; // エラー時も空文字
      }
      // --- selector の処理修正ここまで ---
    }

    // rawtextプロパティを持つオブジェクトの場合、その内容を再帰的にパース
    if (message.rawtext && Array.isArray(message.rawtext)) {
      result += message.rawtext
        .map((nestedMsg) => RawTextParser.parseSingleMessage(nestedMsg, dimension, location, executor))
        .join("");
    }

    return result;
  }
}

// --- 必要な型定義 ---
// (Minecraft Script API の @minecraft/server モジュールからインポートすることを推奨)

// RawMessage, RawMessageScore, RawText は上記で簡易的に定義済み

// EntitySelector クラスのインポートパスは、実際のプロジェクト構造に合わせてください。
// 例: import { EntitySelector } from './EntitySelectorParser';
