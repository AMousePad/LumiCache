/**
 * How each Lumiverse macro behaves over the life of a chat.
 * Names are lowercase, the way the macro parser reports them, and include host aliases.
 */
const names = (text: string) => new Set(text.trim().split(/\s+/));

/** Changes with the clock. */
export const CLOCK = names("time date weekday isotime isodate datetimeformat chatage chat_age");

/** Changes as messages arrive, or from one generation type to the next. */
export const TURN = names(`
  messagecount message_count lastmessageid last_message_id lastmessage last_message lastusermessage last_user_message
  lastcharmessage last_char_message lastbotmessage lastmessagename last_message_name input userinput user_input
  loomlastusermessage loomlastcharmessage loomlastmessagename lumiamessagecount lumiaooctrigger
  firstincludedmessageid first_included_message_id firstdisplayedmessageid first_displayed_message_id
  lastswipeid last_swipe_id currentswipeid current_swipe_id rejectedswipe rejected_swipe rejectedgeneration regeneratedmessage
  lastgenerationtype last_generation_type messagesby messages_by msgby
`);

/** Follows whichever character is taking the turn. Empty outside a group chat. */
export const FOCUS = names(`
  chargroupfocused charfocused char_group_focused chargroupfocuseddescription charfocuseddescription char_group_focused_description
  chargroupfocusedpersonality charfocusedpersonality char_group_focused_personality groupothers group_others
  grouplastspeaker group_last_speaker
`);

/** Follows whichever player is taking the turn. Empty outside a multiplayer room. */
export const ROOM_TURN = names("currentplayer current_player currentturn current_turn");

/** Filled in per generation, so it can differ between sends. */
const FETCHED = "Lumiverse fetches this for each generation, so it can differ between sends.";
const LORE = "This is filled by whichever lore entries activate.";
export const RETRIEVED = new Map<string, string>([
  ...[...names(`
    memories memoriesraw memoriesactive memoriescount longtermmemory chatmemory ltm
    databank databankraw databankactive databankcount databankmemory documents knowledgebank
    entities entityfacts relationships arc memorysalience cortexactive entitycount charactercolors
    websearchcontext web_search_context lumiacouncildeliberation loomcouncilresult
  `)].map((name): [string, string] => [name, FETCHED]),
  ["loomsummary", "This changes each time Loom writes a new summary."],
  ["outlet", LORE], ["wi_marker", LORE], ["wimarker", LORE],
]);

/** Only change when the user changes something outside the chat, but that can happen without touching the preset. */
export const SETTINGS = names("ismobile is_mobile usercolormode user_color_mode colormode color_mode hasextension has_extension");

/** The card fields that follow the focused character in a swap-mode group chat. */
export const CARD = names(`
  char charname description chardescription personality charpersonality scenario charscenario original
  mesexamples mes_examples examplemessages mesexamplesraw mes_examples_raw system charprompt charsystem charsystemprompt
  charposthistoryinstructions char_post_history_instructions charinstruction jailbreak charjailbreak
  chardepthprompt char_depth_prompt depth_prompt charcreatornotes char_creator_notes creatornotes
  charversion char_version charcreator char_creator firstmessage firstmes first_message
  chartags char_tags charactertags tags tag tagat tag_at chartagat nthtag tagcount tag_count tags_count numtags chartagcount hastag has_tag chartag char_tag tagged
`);

/** Set when the chat is made, or changed only on purpose. Not worth a flag. */
export const FIXED = new Set([...CARD, ...names(`
  user notchar not_char group groupnotmuted group_not_muted groupmembercount group_member_count
  isgroupchat is_group_chat groupcardmode group_card_mode isnarrator is_narrator
  ismultiplayer is_multiplayer ismultiplayerroom is_multiplayer_room playercount player_count playerscount players_count
  players player_names playernames hostname host_name chatid chat_id
  persona userpersona persona_outlet personaoutlet
  sub subjectivepronoun personasubjectivepronoun obj objectivepronoun personaobjectivepronoun
  poss possessivepronoun personapossessivepronoun ref reflexivepronoun personareflexivepronoun
  poss_p possessivepronounstandalone personapossessivepronounstandalone
  model maxprompt maxprompttokens max_prompt maxcontext maxcontexttokens max_context maxresponse maxresponsetokens max_response
  reasoningprefix reasoning_prefix reasoningsuffix reasoning_suffix mcptools mcp_tools mcptoolsactive mcp_tools_active
  promptblockrole prompt_block_role blockrole promptblockposition prompt_block_position blockposition promptblockdepth prompt_block_depth blockdepth
  regexinstalled regex_installed hasregex has_regex banned space newline nl n
  lumiadef lumiabehavior lumiapersonality loomstyle loomutils loomretrofits lumiaooc lumiaoocerotic lumiaooceroticbleed
  lumiacouncilinst lumiaself lumiacouncilmodeactive lumiaquirks lumiacouncilquirks lumiastatesynthesis
  lumiacounciltoolsactive lumiacounciltoolslist loomsummaryprompt loomsovhandactive
`)]);

/** Output depends only on the arguments, so these are as stable as what they are given. */
export const PURE = names(`
  eq ne not gt lt gte lte empty isempty blank isblank number isnumber numeric integer isinteger int
  matches startswith starts_with endswith ends_with
  len length replace substr substring split join repeat wrap regex tokencount token_count tokens truncate
  calc math evaluate min max clamp abs floor ceil mod round rcounter
  range count listlength list_count includes contains inlist nth at first last slice take sort unique dedupe distinct
  reverselist reverse_list sum avg mean average listmax list_max listmin list_min bullets numbered ol enumerate
  path jsonget json_get jsonset json_set jsondelete json_delete jsonhas json_has jsonkeys json_keys
  jsonlength json_length jsonescape json_escape jsonpretty json_pretty jsonblock json_block
`);

/** Pure macros whose result can hold still while their input moves, such as the length of a shuffled list. */
export const ABSORBING = names(`
  len length count listlength list_count sum avg mean average min max listmax list_max listmin list_min sort
  tokencount token_count tokens includes contains inlist empty isempty blank isblank number isnumber numeric integer isinteger int
`);

/** Depend on a variable without returning its plain value. */
export const PEEKS: Record<string, string> = {
  hasvar: "var", varexists: "var", haspromptvar: "var", haspresetvar: "var", vardefault: "var", promptvardefault: "var", presetvardefault: "var", getvarkey: "var", getvarindex: "var", hasvarkey: "var",
  hasgvar: "gvar", hasglobalvar: "gvar", gvarexists: "gvar", getgvarkey: "gvar", getglobalvarkey: "gvar", getglobalvarindex: "gvar", hasgvarkey: "gvar", hasglobalvarkey: "gvar",
  haschatvar: "chatvar", getchatvarkey: "chatvar", haschatvarkey: "chatvar",
};

/** Change a variable without going through the plain set/add/inc/dec forms. */
export const KEY_WRITES: Record<string, string> = {
  setvarkey: "var", setvarindex: "var", addvarkey: "var", deletevarkey: "var",
  setgvarkey: "gvar", setglobalvarkey: "gvar", setglobalvarindex: "gvar", addgvarkey: "gvar", addglobalvarkey: "gvar", deletegvarkey: "gvar", deleteglobalvarkey: "gvar",
  setchatvarkey: "chatvar", addchatvarkey: "chatvar", deletechatvarkey: "chatvar",
};
export const DELETES: Record<string, string> = { deletevar: "var", flushvar: "var", deletegvar: "gvar", flushgvar: "gvar", flushglobalvar: "gvar", deleteglobalvar: "gvar", deletechatvar: "chatvar", flushchatvar: "chatvar" };
