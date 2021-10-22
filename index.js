const mineflayer = require('mineflayer')
const fs = require('fs');
let rawdata = fs.readFileSync('config.json');
let data = JSON.parse(rawdata);
var lasttime = -1;
var moving = 0;
var connected = 0;
var actions = [ 'forward', 'sprint', 'sprint', 'forward']
var lastaction;
var pi = 3.14159;
var moveinterval = 0.1; // 0.1 second movement interval
var maxrandom = 5; // 0-5 seconds added to movement interval (randomly)
var host = data["ip"];
var username = data["name"]
var bot = mineflayer.createBot({
  host: host,
  username: username
});
function getRandomArbitrary(min, max) {
       return Math.random() * (max - min) + min;

}
bot.on('login',function(){
	console.log("Logged In")
});
bot.on('time', function() {
    if (connected <1) {
        return;
    }
    if (lasttime<0) {
        lasttime = bot.time.age;
    } else {
        var randomadd = Math.random() * maxrandom * 20;
        var interval = moveinterval*20 + randomadd;
        if (bot.time.age - lasttime > interval) {
		
            if (moving == 1) {
                bot.setControlState(lastaction,false);
                moving = 0;
                lasttime = bot.time.age;
            } else {
                var yaw = Math.random()*pi - (0.5*pi);
                var pitch = Math.random()*pi - (0.5*pi);
                bot.look(yaw,pitch,false);
                lastaction = actions[Math.floor(Math.random() * actions.length)];
                bot.setControlState(lastaction,true);
                moving = 1;
                lasttime = bot.time.age;
                bot.activateItem();
            }
        }
    }
});

bot.on('spawn',function() {
    connected=1;
});

function lookAtNearestPlayer () {
  const playerFilter = (entity) => entity.type === 'player'
  const playerEntity = bot.nearestEntity(playerFilter)
  
  if (!playerEntity) return
  
  const pos = playerEntity.position.offset(0, playerEntity.height, 0)
  bot.lookAt(pos)
}

bot.on('physicTick', lookAtNearestPlayer)

})

bot.loadPlugin(pathfinder)
bot.loadPlugin(armorManager)

const VIEW_RANGE = 16
const FOLLOW_RANGE = 2
const ATTACK_RANGE = 3.75

let fighting = false
let target = null
let guardMode = false
let gaurdPos = null

bot.once('spawn', () => {
    const mcData = require('minecraft-data')(bot.version)
    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)
})

function guardArea (pos) {
    guardMode = true
    gaurdPos = pos
}

function stopGuarding () {
    guardMode = false
}

bot.on('physicTick', () => {
    if (!guardMode) return

    const entity = getNearestTarget(false)
    if (entity && entity.position.distanceTo(bot.entity.position) < VIEW_RANGE) {
        startFighting(entity)
        return
    }

    if (fighting) return
    if (bot.pathfinder.isMoving()) return
    
    if (bot.entity.position.distanceTo(gaurdPos) > 1) {
        bot.pathfinder.setGoal(new goals.GoalBlock(gaurdPos.x, gaurdPos.y, gaurdPos.z))
    }
})

bot.on('physicTick', () => {
    if (!guardMode) return
    if (!fighting) return

    if (target.position.distanceTo(bot.entity.position) > VIEW_RANGE)
        stopFighting()
})

function startFighting (entity) {
    if (fighting && target === entity) return

    fighting = true
    target = entity

    bot.pathfinder.setGoal(new goals.GoalFollow(target, FOLLOW_RANGE), true)
    chargeAttack()
}

function stopFighting () {
    fighting = false
    target = null

    bot.pathfinder.setGoal(null)
}

function getNearestTarget (players) {
    const filter = e => {
        if (e.position.distanceTo(bot.entity.position) > VIEW_RANGE) return false
        if (e.type !== 'player' && e.type !== 'mob') return false
        if (e.type === 'player' && !players) return false
        if (e.type === 'mob' && e.mobType === 'Armor Stand') return false

        return true
    }
    return bot.nearestEntity(filter)
}

bot.on('chat', (username, message) => {
    if (username === bot.username) return

    if (message === 'go') {
        const entity = getNearestTarget(true)

        if (!entity) {
            bot.chat("I don't see any targets nearby.")
            return
        }

        startFighting(entity)
    }

    if (message === 'guard') {
        const player = bot.players[username]

        if (!player) {
            bot.chat("I can't see you.")
            return
        }

        guardArea(player.entity.position)
    }

    if (message === 'stop') { 
        stopFighting()
        stopGuarding()
    }
})

bot.on('physicTick', () => {
    if (bot.pathfinder.isMoving()) return
    if (fighting) return

    const entity = bot.nearestEntity()
    if (entity)
        bot.lookAt(entity.position.offset(0, entity.height, 0))
})

bot.on('playerCollect', (collector, itemDrop) => {
    if (collector !== bot.entity) return

    setTimeout(() => {
        const queue = new TaskQueue()
    
        const sword = bot.inventory.items().find(item => item.name.includes('sword'))
        if (sword) {
            queue.add(cb => bot.equip(sword, 'hand', cb))
            queue.add(cb => setTimeout(cb, 100))
        }

        const shield = bot.inventory.items().find(item => item.name.includes('shield'))
        if (shield) {
            queue.add(cb => bot.equip(shield, 'off-hand', cb))
            queue.add(cb => setTimeout(cb, 100))
        }
    
        queue.runAll()
    }, 150)
})

bot.on('entityGone', (entity) => {
    if (entity === target) {
        stopFighting()

        if (!guardMode) {
            setTimeout(() => {
                bot.chat('I won.')
            }, 1000)
        }
    }
})

bot.on('death', () => {
    stopFighting()

    if (!guardMode) {
        setTimeout(() => {
            bot.chat('I lost...')
        }, 1000)
    }
})

let timeUntilNextAttack = 0
bot.on('physicTick', () => {
    if (!fighting) return

    timeUntilNextAttack--
    if (timeUntilNextAttack > 0) return

    timeUntilNextAttack = Math.random() * 10 + 10
})

function hasShield () {
    if (bot.supportFeature('doesntHaveOffHandSlot')) return false

    const slot = bot.inventory.slots[bot.getEquipmentDestSlot('off-hand')]
    if (!slot) return false

    return slot.name.includes('shield')
}

function chargeAttack () {
    if (hasShield() && bot.entity.position.distanceTo(target.position) < ATTACK_RANGE)
        bot.activateItem(true) // Raise shield

    const time = Math.random() * 500 + 500
    setTimeout(tryAttack, time)
}

function tryAttack () {
    if (!fighting) return

    if (target && bot.entity.position.distanceTo(target.position) < ATTACK_RANGE) {
        const queue = new TaskQueue()

        if (hasShield()) {
            queue.addSync(bot.deactivateItem()) // Lower shield
            queue.add(cb => setTimeout(cb, 100))
        }
            
        queue.add(cb => bot.lookAt(target.position.offset(0, target.height, 0), true, cb))
        queue.addSync(bot.attack(target, true))
        queue.add(cb => setTimeout(cb, 150))

        queue.runAll(chargeAttack)
    }
    else
        chargeAttack()
}
