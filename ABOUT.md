# Science of Slaughter

A project to simulate the binomial combat probabilities of the different 
Phases for Horus Heresy 3rd Edition. 

## Project overview

Too often conversations around the odds of one unit "defeating" another unit
or succeeding in some objective focus around the "average" result. Something 
like:

"Oh well this unit will do 3.666666... wounds so it should be fine"

There are a few problems with this. Firstly, we don't have 0.666666... of a 
model remove. Secondly, it's often more useful to know "I've got a 43% chance
of removing X models" than knowing the average number of wounds inflicted.

This project aims to rectify this by providing an interactive UI where 
curious players can investigate these kind of probabilities and make informed 
decisions.

## State of the Project

Currently, the project has:

* Probabilities for Shooting attacks against Infantry. This can also be used to simulate Volley Attacks as part of the Charge Phase. At this stage, all models are assumed to fire the same weapon.
* Probabilities for casualties close combat attacks against Infantry. At this stage, all models are assumed to be attacking with the same weapon and have the same base profile (Weapon Skill, Attacks, etc).

Future developments will include:

* Mixed weapons to be incorporated into the shooting vs infantry utility
* Probabilities for shooting attacks against vehicles
* Probabilities for close combat attacks against vehicles
* Probabilities for outcomes in a Challenge
* Probabilities for advanced statistics outcome (i.e. statuses, combat outcomes)
* Comparative capabilities between different weapons, different squad loadouts etc