# RPG (Web + Node + WebSockets)

## Run

1. `npm install`
2. `npm start`
3. Open http://localhost:3000

## Controls

- Move: WASD or Arrow Keys
- Menu: Esc
- Interact/Engage: Enter (interact with the tile/object in front of you)

## Overworld interactions

- Push blocks: face a block and press Enter
- Torches: face a torch and press Enter (toggle), or use Fire Rod
- Switches: face a switch and press Enter (drains water / flips bridges)
- Combat: enemies roam in real time, but battle only starts when you face one and press Enter

## Tools (navigation-focused)

Open the menu (Esc) to use:

- Bomb Flower: removes a cracked wall directly in front of you
- Grappling Hook: pulls you across water toward a ledge
- Fire Rod: lights the first torch in front of you

## Saving

- Local: stored in `localStorage` key `rpg.save.v1`
- Export: downloads a JSON savefile
- Import: load a JSON savefile back in

