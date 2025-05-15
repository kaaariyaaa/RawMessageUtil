import {
  world,
  Dimension,
  Entity,
  Block,
  Vector3,
  ScoreboardIdentity,
  ScoreboardObjective, // Objectiveの型として明示
  Player,
  ScoreboardScoreInfo, // getScores()の戻り値の型
} from "@minecraft/server";

import { EntitySelector } from "./EntitySelectorParser";

// RawMessageの型定義
interface RawMessage {
  text?: string;
  translate?: string;
  with?: string[] | RawMessage | RawMessage[]; // 配列も許容するように修正
  score?: RawMessageScore;
  selector?: string;
  rawtext?: RawMessage[]; // これは通常、トップレベルの RawText オブジェクトで使われます
  // Minecraftの RawMessage には color や bold などの書式設定プロパティもありますが、
  // このパーサーはそれらを解釈して適用するのではなく、テキストとして抽出することを目的としています。
  // 色コード(§)はテキスト内に直接含める想定です。
}

interface RawMessageScore {
  name: string; // スコアホルダー名 (プレイヤー名、セレクタ、"*"、またはフェイクプレイヤー名)
  objective: string; // 目的名
  // value?: string; // 通常、Script API側で設定するものではなく、ゲームが解釈するもの
}

interface RawText {
  rawtext?: RawMessage[];
}

// パラメータ受け渡しを簡略化するための実行コンテキストインターフェース
interface ExecutionContext {
  dimension: Dimension;
  location?: Vector3;
  executor?: Entity;
}

export class RawMessageParser {
  /**
   * RawMessage、RawMessage の配列、RawText オブジェクト、または rawText形式のJSON文字列を、
   * 装飾コードを保持したテキストに変換します。
   * @param rawInput 変換する RawMessage、RawMessage の配列、RawText オブジェクト、または rawText形式のJSON文字列。
   * @param executionSource オプション。セレクタの解決やスコア取得の基準となるエンティティ、ブロック、またはディメンション。
   * @returns 変換されたテキスト文字列（装飾コードを含む）。
   */
  public static parse(
    rawInput: RawMessage | RawMessage[] | RawText | string | undefined,
    executionSource?: Entity | Block | Dimension | Vector3
  ): string {
    if (!rawInput) {
      return "";
    }

    // 必要に応じて文字列入力をオブジェクトにパースする
    const parsedObject = this.parseInputToObject(rawInput);
    if (!parsedObject) {
      return "";
    }

    // ソースから実行コンテキストを作成
    const context = this.createExecutionContext(executionSource);

    // 異なる入力タイプを処理
    if (Array.isArray(parsedObject)) {
      return parsedObject.map((msg) => this.parseSingleMessage(msg, context)).join("");
    } else if (this.isRawText(parsedObject)) {
      return (parsedObject.rawtext || []).map((msg) => this.parseSingleMessage(msg, context)).join("");
    } else if (this.isRawMessage(parsedObject)) {
      return this.parseSingleMessage(parsedObject, context);
    } else {
      // 文字列の場合はそのまま返す（装飾コードは保持）
      return String(parsedObject);
    }
  }

  /**
   * 必要に応じて文字列入力をオブジェクトにパースする
   */
  private static parseInputToObject(
    rawInput: RawMessage | RawMessage[] | RawText | string | undefined
  ): RawMessage | RawMessage[] | RawText | string | undefined {
    if (typeof rawInput === "string") {
      try {
        // まずJSONとしてパースを試みる
        return JSON.parse(rawInput) as RawMessage | RawMessage[] | RawText;
      } catch (error) {
        // JSONパースに失敗した場合は、通常の文字列として扱う（装飾コードは保持）
        return rawInput;
      }
    }
    return rawInput;
  }

  /**
   * RawTextオブジェクトの型ガード
   */
  private static isRawText(obj: any): obj is RawText {
    return typeof obj === "object" && obj !== null && !Array.isArray(obj) && "rawtext" in obj;
  }

  /**
   * RawMessageオブジェクトの型ガード
   * (RawTextオブジェクトではない、かつ配列ではないオブジェクトをRawMessageとみなす)
   */
  private static isRawMessage(obj: any): obj is RawMessage {
    return typeof obj === "object" && obj !== null && !Array.isArray(obj) && !("rawtext" in obj);
  }

  /**
   * ソースから実行コンテキストを作成する
   */
  private static createExecutionContext(executionSource?: Entity | Block | Dimension | Vector3): ExecutionContext {
    const context: ExecutionContext = {
      dimension: world.getDimension("overworld"), // デフォルトはオーバーワールド
    };

    if (executionSource) {
      if (executionSource instanceof Dimension) {
        context.dimension = executionSource;
      } else if (executionSource instanceof Block) {
        context.dimension = executionSource.dimension;
        context.location = executionSource.location;
      } else if (executionSource instanceof Entity) {
        context.dimension = executionSource.dimension;
        context.location = executionSource.location;
        context.executor = executionSource;
      } else if (
        typeof executionSource === "object" &&
        "x" in executionSource &&
        "y" in executionSource &&
        "z" in executionSource
      ) {
        // Vector3 の場合
        context.location = executionSource as Vector3;
        // Dimension が指定されていない場合、デフォルトを使用
      }
    }
    return context;
  }

  /**
   * 単一のRawMessageオブジェクトをテキストに変換し、書式コードを保持する
   */
  private static parseSingleMessage(message: RawMessage, context: ExecutionContext): string {
    let result = "";

    if (message.text) {
      // テキストをそのまま追加（装飾コード、改行コード \n を保持）
      result += message.text;
    } else if (message.translate) {
      result += this.handleTranslate(message, context);
    } else if (message.score && message.score.name && message.score.objective) {
      // context.dimensionのチェックは不要かも
      result += this.handleScore(message.score, context);
    } else if (message.selector) {
      // context.dimensionのチェックは不要かも
      result += this.handleSelector(message.selector, context);
    }

    // `rawtext` は通常トップレベルの `{ "rawtext": [...] }` で使われるが、
    // 一部の複雑なケースではネストされる可能性も考慮する（ただし標準的ではない）
    // しかし、提供された型定義では RawMessage 内に rawtext があるため、ここでも処理する。
    if (message.rawtext && Array.isArray(message.rawtext)) {
      result += message.rawtext.map((nestedMsg) => this.parseSingleMessage(nestedMsg, context)).join("");
    }

    return result;
  }

  /**
   * translateコンポーネントを処理する
   */
  private static handleTranslate(message: RawMessage, context: ExecutionContext): string {
    // 翻訳キー自体を返すのが一般的。実際の翻訳はクライアント側で行われる。
    // Script API側で翻訳済み文字列を取得する標準的な方法はない。
    let translatedText = message.translate || ""; // 翻訳キー

    if (message.with) {
      const withValues: string[] = [];
      if (Array.isArray(message.with)) {
        for (const val of message.with) {
          if (typeof val === "string") {
            withValues.push(val);
          } else {
            // val が RawMessage オブジェクトの場合、再帰的にパース
            withValues.push(this.parseSingleMessage(val, context));
          }
        }
      } else if (typeof message.with === "object") {
        // message.with が単一の RawMessage オブジェクトの場合
        withValues.push(this.parseSingleMessage(message.with as RawMessage, context));
      }
      // 実際のゲーム内では、これらの値が %s や %1$s などに置換される
      // ここではデバッグ目的で翻訳キーとパラメータを示す文字列を返す
      if (withValues.length > 0) {
        return `${translatedText} [${withValues.join(", ")}]`;
      }
    }
    return translatedText; // パラメータがない場合はキーのみ
  }

  /**
   * scoreコンポーネントを処理する
   */
  private static handleScore(scoreInfo: RawMessageScore, context: ExecutionContext): string {
    const scoreHolderName = scoreInfo.name;
    let scoreValueText = "0"; // スコアが見つからない場合のデフォルト値

    try {
      const objective = world.scoreboard.getObjective(scoreInfo.objective);
      if (!objective) {
        console.warn(`[RawMessageParser] 目的 "${scoreInfo.objective}" が見つかりません。`);
        return scoreValueText; // 目的が見つからない場合はデフォルト値
      }

      if (scoreHolderName === "*") {
        // ワイルドカードは実行者自身を指す (executorが必須)
        if (context.executor && context.executor.scoreboardIdentity) {
          try {
            const score = objective.getScore(context.executor.scoreboardIdentity);
            scoreValueText = score !== undefined ? String(score) : "0";
          } catch (e) {
            // スコアが存在しない場合などにエラーになることがある
            // console.warn(`[RawMessageParser] 実行者の目的 "${scoreInfo.objective}" のスコアが見つかりません。`);
            scoreValueText = "0";
          }
        } else {
          // console.warn(`[RawMessageParser] ワイルドカードスコア用の実行者が利用できません。目的: "${scoreInfo.objective}"`);
          scoreValueText = "0"; // 実行者がいない場合は0
        }
      } else if (scoreHolderName.startsWith("@")) {
        // セレクタの場合
        const selector = new EntitySelector(scoreHolderName, context.dimension, context.location, context.executor);
        const entities = selector.getEntities();
        if (entities.length > 0 && entities[0].scoreboardIdentity) {
          try {
            const score = objective.getScore(entities[0].scoreboardIdentity);
            scoreValueText = score !== undefined ? String(score) : "0";
          } catch (e) {
            // console.warn(`[RawMessageParser] セレクタ "${scoreHolderName}" の目的 "${scoreInfo.objective}" のスコアが見つかりません。`);
            scoreValueText = "0";
          }
        } else {
          // console.warn(`[RawMessageParser] スコア用のセレクタ "${scoreHolderName}" に一致するエンティティが見つかりません。目的: "${scoreInfo.objective}"`);
          scoreValueText = "0"; // セレクタでエンティティが見つからない場合
        }
      } else {
        // プレイヤー名またはフェイクプレイヤー名
        const participants = world.scoreboard.getParticipants();
        const targetParticipant = participants.find((p) => p.displayName === scoreHolderName);
        if (targetParticipant) {
          try {
            const score = objective.getScore(targetParticipant);
            scoreValueText = score !== undefined ? String(score) : "0";
          } catch (e) {
            // console.warn(`[RawMessageParser] "${scoreHolderName}" の目的 "${scoreInfo.objective}" のスコアが見つかりません。`);
            scoreValueText = "0";
          }
        } else {
          // console.warn(`[RawMessageParser] 参加者 "${scoreHolderName}" が目的 "${scoreInfo.objective}" に見つかりません。`);
          scoreValueText = "0"; // 参加者が見つからない場合
        }
      }
    } catch (e) {
      console.warn(`[RawMessageParser] "${scoreInfo.name}" の目的 "${scoreInfo.objective}" のスコア取得中にエラーが発生しました: ${e}`);
      scoreValueText = "0"; // その他のエラー時
    }
    return scoreValueText;
  }

  /**
   * selectorコンポーネントを処理する
   */
  private static handleSelector(selectorStr: string, context: ExecutionContext): string {
    // EntitySelectorParser が完全に実装されている前提
    // この例では EntitySelector の getEntities が限定的なため、結果も限定的になる
    try {
      const selector = new EntitySelector(selectorStr, context.dimension, context.location, context.executor);
      const selectedEntities = selector.getEntities();

      if (selectedEntities.length > 0) {
        return selectedEntities
          .map((e) => {
            // Player インスタンスかどうかを安全にチェック
            if (e instanceof Player) {
              return e.name; // プレイヤー名
            } else if (e.nameTag) {
              return e.nameTag; // NameTag があればそれを使用
            } else {
              return e.typeId; // それ以外は typeId (e.g., "minecraft:pig")
            }
          })
          .join(", ");
      }
    } catch (e) {
      console.warn(`[RawMessageParser] セレクタ "${selectorStr}" の解決中にエラーが発生しました: ${e}`);
    }
    // セレクタが解決できなかった場合やエンティティが見つからなかった場合は、
    // Minecraft の挙動に合わせるなら空文字列ではなく、セレクタ文字列自体を返すことも考えられる。
    // ここでは空文字列を返す。
    return "";
  }
}
